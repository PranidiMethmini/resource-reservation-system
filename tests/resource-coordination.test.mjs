import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { resourceLockModule } from "./resource-lock-fixture.mjs";

// Deterministic simulation of transaction/row-lock ordering. These tests do
// not connect to PostgreSQL and do not prove its actual concurrency behavior.
const source = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bookingCode = source("../src/app/api/reservations/route.ts");
const resourceCode = source("../src/app/api/resources/[id]/route.ts");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const resourceData = { name: "Fixture Room", type: "Room", location: "Floor 1", capacity: 8, description: "", isActive: true };
const bookingRequest = (resourceId = "r", overrides = {}) => new Request("http://localhost/api/reservations", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ resourceId, startTime: "2099-01-01T10:00:00Z", endTime: "2099-01-01T11:00:00Z", ...overrides }),
});
const context = (id = "r") => ({ params: Promise.resolve({ id }) });
const patchRequest = (isActive) => new Request("http://localhost/api/resources/r", {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...resourceData, isActive }),
});

function world({ active = true, reservations = [] } = {}) {
  const rows = new Map([['r', { id: 'r', ...resourceData, isActive: active }], ['s', { id: 's', ...resourceData }]]);
  const bookings = [...reservations];
  const queues = new Map();
  const events = [];
  let sequence = 0;
  async function acquire(id, kind, hooks) {
    const previous = queues.get(id) || Promise.resolve();
    const release = deferred();
    queues.set(id, previous.then(() => release.promise));
    events.push(`waiting:${kind}:${id}`); hooks.waiting?.();
    await previous;
    events.push(`locked:${kind}:${id}`);
    return release.resolve;
  }
  function client(kind, { role = "USER", authenticated = true, hooks = {}, clock } = {}) {
    const prisma = {
      user: { findUnique: async () => ({ id: `${kind}-owner`, role }) },
      $transaction: async (callback, options) => {
        assert.equal(options.isolationLevel, "ReadCommitted");
        assert.equal(options.timeout, 8000);
        const updates = new Map(), creates = [], releases = [];
        let lockedId = null;
        const tx = {
          $executeRaw: async (strings) => { events.push(strings.join("")); return 0; },
          $queryRaw: async (strings, id) => {
            assert.ok(strings.join("?").includes("FOR UPDATE"));
            assert.equal(lockedId, null, "Each transaction locks just one resource");
            if (hooks.lockError) throw hooks.lockError;
            releases.push(await acquire(id, kind, hooks)); lockedId = id;
            await hooks.locked?.();
            const row = rows.get(id);
            return row ? [{ id, isActive: row.isActive }] : [];
          },
          resource: { update: async ({ where, data }) => {
            assert.equal(where.id, lockedId);
            const row = { ...rows.get(where.id), ...data }; updates.set(where.id, row); return row;
          } },
          reservation: {
            findFirst: async ({ where }) => {
              assert.equal(where.resourceId, lockedId);
              await hooks.overlap?.();
              return bookings.find((item) => item.resourceId === where.resourceId && item.status === "CONFIRMED" && item.startTime < where.startTime.lt && item.endTime > where.endTime.gt) || null;
            },
            create: async ({ data }) => {
              assert.equal(data.resourceId, lockedId); assert.equal(rows.get(lockedId).isActive, true);
              if (hooks.createError) throw hooks.createError;
              const row = { id: `booking-${++sequence}`, ...data }; creates.push(row); return row;
            },
          },
        };
        try {
          const result = await callback(tx);
          for (const [id, value] of updates) rows.set(id, value);
          bookings.push(...creates); events.push(`committed:${kind}`);
          return result;
        } finally { releases.forEach((release) => release()); }
      },
    };
    const ControlledDate = clock ? class extends Date {
      constructor(value) { super(arguments.length ? value : clock.now); }
      static now() { return clock.now; }
    } : Date;
    function load(code) {
      const exports = {};
      runInNewContext(code, { exports, Date: ControlledDate, console: { error() {} }, require: (name) => {
        if (name === "@/lib/prisma") return { prisma };
        if (name === "@/auth") return { auth: async () => authenticated ? { user: { email: `${kind}@example.com` } } : null };
        if (name === "@/lib/resource-lock") return resourceLockModule;
        if (name === "next/server") return { NextResponse: Response };
        if (name === "zod") return { z };
        throw new Error(`Unexpected import: ${name}`);
      } });
      return exports;
    }
    return { book: load(bookingCode).POST, ...load(resourceCode) };
  }
  return { rows, bookings, events, client };
}

test("active booking uses session ownership; inactive and missing resources are rejected", async () => {
  const active = world();
  assert.equal((await active.client("user").book(bookingRequest("r", { userId: "victim" }))).status, 201);
  assert.equal(active.bookings[0].userId, "user-owner");
  assert.equal((await world({ active: false }).client("user").book(bookingRequest())).status, 404);
  assert.equal((await world().client("user").book(bookingRequest("missing"))).status, 404);
});

for (const method of ["DELETE", "PATCH"]) test(`${method} deactivation wins the lock: waiting booking reads inactive and does not insert`, { timeout: 3000 }, async () => {
  const w = world(); const locked = deferred(), release = deferred(), waiting = deferred();
  const admin = w.client("admin", { role: "ADMIN", hooks: { locked: async () => { locked.resolve(); await release.promise; } } });
  const deactivation = method === "DELETE" ? admin.DELETE(new Request("http://localhost/api/resources/r", { method }), context()) : admin.PATCH(patchRequest(false), context());
  await locked.promise;
  const booking = w.client("user", { hooks: { waiting: waiting.resolve } }).book(bookingRequest());
  await waiting.promise; release.resolve();
  assert.equal((await deactivation).status, 200); assert.equal((await booking).status, 404);
  assert.equal(w.bookings.length, 0); assert.equal(w.rows.get("r").isActive, false);
});

test("booking wins the lock: deactivation waits until insertion commits and preserves the reservation", { timeout: 3000 }, async () => {
  const w = world(); const checked = deferred(), release = deferred(), waiting = deferred();
  const booking = w.client("user", { hooks: { overlap: async () => { checked.resolve(); await release.promise; } } }).book(bookingRequest());
  await checked.promise;
  const deactivation = w.client("admin", { role: "ADMIN", hooks: { waiting: waiting.resolve } }).DELETE(new Request("http://localhost/api/resources/r", { method: "DELETE" }), context());
  await waiting.promise;
  assert.equal(w.rows.get("r").isActive, true); release.resolve();
  assert.equal((await booking).status, 201); assert.equal((await deactivation).status, 200);
  assert.equal(w.rows.get("r").isActive, false); assert.equal(w.bookings.length, 1); assert.equal(w.bookings[0].status, "CONFIRMED");
  assert.ok(w.events.indexOf("committed:user") < w.events.indexOf("locked:admin:r"));
});

test("simultaneous conflicting bookings serialize in the simulation: one 201 and one 409", async () => {
  const w = world();
  const results = await Promise.all([w.client("one").book(bookingRequest()), w.client("two").book(bookingRequest())]);
  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]); assert.equal(w.bookings.length, 1);
});

test("existing overlap still rejects, while adjacent slots and different resources succeed", async () => {
  const w = world(); const user = w.client("user");
  assert.equal((await user.book(bookingRequest())).status, 201);
  assert.equal((await user.book(bookingRequest())).status, 409);
  assert.equal((await user.book(bookingRequest("r", { startTime: "2099-01-01T11:00:00Z", endTime: "2099-01-01T12:00:00Z" }))).status, 201);
  assert.equal((await user.book(bookingRequest("s"))).status, 201);
});

test("future start is rechecked after lock wait and again before insertion", async () => {
  for (const phase of ["locked", "overlap"]) {
    const clock = { now: Date.parse("2099-01-01T09:59:59Z") };
    const w = world();
    const user = w.client("user", { clock, hooks: { [phase]: () => { clock.now = Date.parse("2099-01-01T10:00:01Z"); } } });
    assert.equal((await user.book(bookingRequest())).status, 400); assert.equal(w.bookings.length, 0);
  }
});

test("deactivation leaves all existing reservations unchanged; reactivation remains supported", async () => {
  const existing = { id: "existing", resourceId: "r", userId: "owner", status: "CONFIRMED", startTime: new Date("2099-01-02T10:00:00Z"), endTime: new Date("2099-01-02T11:00:00Z") };
  const w = world({ reservations: [existing] }); const before = JSON.stringify(w.bookings);
  const admin = w.client("admin", { role: "ADMIN" });
  assert.equal((await admin.DELETE(new Request("http://localhost/api/resources/r", { method: "DELETE" }), context())).status, 200);
  assert.equal(JSON.stringify(w.bookings), before);
  assert.equal((await admin.PATCH(patchRequest(true), context())).status, 200);
  assert.equal(w.rows.get("r").isActive, true);
  assert.equal((await w.client("user").book(bookingRequest())).status, 201);
});

test("USER updates/deactivation and signed-out booking are rejected before taking locks", async () => {
  const w = world(); const user = w.client("user");
  assert.equal((await user.PATCH(patchRequest(false), context())).status, 403);
  assert.equal((await user.DELETE(new Request("http://localhost/api/resources/r", { method: "DELETE" }), context())).status, 403);
  assert.equal((await w.client("anonymous", { authenticated: false }).book(bookingRequest())).status, 401);
  assert.equal(w.events.length, 0); assert.equal(w.rows.get("r").isActive, true);
});

test("lock timeouts return retryable 503; exclusion violations still return 409 and leave no staged insert", async () => {
  const busy = world();
  const response = await busy.client("user", { hooks: { lockError: { cause: { originalCode: "55P03" } } } }).book(bookingRequest());
  assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "1"); assert.equal(busy.bookings.length, 0);
  const conflict = world();
  assert.equal((await conflict.client("user", { hooks: { createError: { cause: { originalCode: "23P01" } } } }).book(bookingRequest())).status, 409);
  assert.equal(conflict.bookings.length, 0);
});
