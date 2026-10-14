import { resourceLockModule, withMockTransactions } from "./resource-lock-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const source = readFileSync(new URL("../src/app/api/reservations/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute({ error, overlap = null, active = true, session = true } = {}) {
  const calls = [];
  const prisma = {
    user: { findUnique: async () => ({ id: "authenticated-user" }) },
    resource: { findUnique: async () => ({ isActive: active }) },
    reservation: {
      findFirst: async (args) => { calls.push(args); return overlap; },
      create: async ({ data }) => {
        calls.push(data);
        if (error) throw error;
        return { id: "new-reservation", ...data };
      },
    },
  };
  withMockTransactions(prisma);
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === "@/lib/resource-lock") return resourceLockModule;
      if (name === "zod") return { z };
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/prisma") return { prisma };
      if (name === "@/auth") return { auth: async () => session ? { user: { email: "user@example.com" } } : null };
      throw new Error(`Unexpected import: ${name}`);
    },
    console: { error: () => {} },
  });
  return { POST: exports.POST, calls };
}

function booking(overrides = {}) {
  return new Request("http://localhost/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resourceId: "resource-a",
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      ...overrides,
    }),
  });
}

test("real PrismaPg exclusion error returns 409 after the precheck passes (no database connection)", async () => {
  class FakePool extends Pool {
    query() {
      return Promise.reject(Object.assign(new Error('conflicting key value violates exclusion constraint "Reservation_confirmed_no_overlap"'), {
        code: "23P01", severity: "ERROR",
      }));
    }
  }
  const adapter = await new PrismaPg(new FakePool()).connect();
  let error;
  try {
    await adapter.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] });
  } catch (caught) {
    error = caught;
  } finally {
    await adapter.dispose();
  }
  assert.equal(error.cause.originalCode, "23P01");
  const response = await loadRoute({ error }).POST(booking());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "This resource is already booked for the selected time.");
});

test("Prisma metadata wrapping preserves conflict detection", async () => {
  const error = { code: "P2004", meta: { driverAdapterError: { cause: { originalCode: "23P01" } } } };
  assert.equal((await loadRoute({ error }).POST(booking())).status, 409);
});

test("unrelated database failures remain 500", async () => {
  assert.equal((await loadRoute({ error: { code: "P2004", cause: { code: "23503" } } }).POST(booking())).status, 500);
});

test("existing application overlap check remains 409", async () => {
  const route = loadRoute({ overlap: { id: "existing" } });
  assert.equal((await route.POST(booking())).status, 409);
  assert.equal(route.calls.length, 1);
});

test("successful bookings use authenticated identity and strict confirmed-overlap filters", async () => {
  const route = loadRoute();
  const response = await route.POST(booking({ userId: "another-user" }));
  assert.equal(response.status, 201);
  const { where } = route.calls[0];
  const data = route.calls[1];
  assert.equal(data.userId, "authenticated-user");
  assert.equal(where.resourceId, data.resourceId);
  assert.equal(where.status, "CONFIRMED");
  assert.equal(where.startTime.lt.getTime(), data.endTime.getTime());
  assert.equal(where.endTime.gt.getTime(), data.startTime.getTime());
});

test("authentication and inactive-resource validation remain intact", async () => {
  assert.equal((await loadRoute({ session: false }).POST(booking())).status, 401);
  assert.equal((await loadRoute({ active: false }).POST(booking())).status, 404);
});

test("invalid, reversed, zero-length, and past ranges remain rejected", async () => {
  for (const overrides of [
    { startTime: "invalid" },
    { endTime: "invalid" },
    { startTime: "2099-01-01T12:00:00Z", endTime: "2099-01-01T11:00:00Z" },
    { startTime: "2099-01-01T12:00:00Z", endTime: "2099-01-01T12:00:00Z" },
    { startTime: "2000-01-01T10:00:00Z", endTime: "2000-01-01T11:00:00Z" },
  ]) {
    assert.equal((await loadRoute().POST(booking(overrides))).status, 400);
  }
});
