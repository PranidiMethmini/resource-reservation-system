import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, console: { error() {} }, require: (name) => {
    if (imports[name]) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const helper = load("../src/lib/reservations.ts");
const now = Date.parse("2099-01-01T10:00:00Z");
const make = (id, start, end, status = "CONFIRMED", name = "Meeting Room", location = "North Wing") => ({
  id, resourceId: "resource", startTime: `2099-01-01T${start}:00Z`, endTime: `2099-01-01T${end}:00Z`, status, resource: { name, location, type: "Room" },
});
const records = [make("late", "14:00", "15:00"), make("past", "08:00", "09:00"), make("cancelled", "12:00", "13:00", "CANCELLED"), make("soon", "11:00", "12:00", "CONFIRMED", "Computer Lab", "South Wing"), make("ongoing", "09:30", "10:30")];
const ids = (filter, search = "") => Array.from(helper.organizeReservations(records, filter, search, now), (item) => item.id);

test("upcoming sorts nearest first and excludes ongoing, past, and cancelled", () => {
  assert.deepEqual(ids("upcoming"), ["soon", "late"]);
});
test("Past means ended CONFIRMED bookings; Cancelled remains separate", () => {
  assert.deepEqual(ids("past"), ["past"]);
  assert.deepEqual(ids("cancelled"), ["cancelled"]);
});
test("All groups ongoing first, then upcoming, completed, and cancelled", () => {
  assert.deepEqual(ids("all"), ["ongoing", "soon", "late", "past", "cancelled"]);
  assert.equal(records[0].id, "late");
});
test("search matches name or location without case/outer-whitespace sensitivity", () => {
  assert.deepEqual(ids("all", "  computer LAB  "), ["soon"]);
  assert.deepEqual(ids("upcoming", "SOUTH"), ["soon"]);
  assert.deepEqual(ids("cancelled", "south"), []);
});
test("start/end boundaries derive status correctly and only future confirmed bookings can cancel", () => {
  const startingNow = make("start", "10:00", "11:00");
  const endingNow = make("end", "09:00", "10:00");
  assert.equal(helper.reservationState(startingNow, now), "Ongoing");
  assert.equal(helper.reservationState(endingNow, now), "Completed");
  assert.equal(helper.canCancelReservation(startingNow, now), false);
  assert.equal(helper.canCancelReservation(endingNow, now), false);
  assert.equal(helper.canCancelReservation(records[2], now), false);
  assert.equal(helper.canCancelReservation(records[3], now), true);
});
test("empty and no-match lists are handled; past sorts most recent first", () => {
  assert.equal(helper.organizeReservations([], "all", "", now).length, 0);
  assert.deepEqual(ids("all", "not found"), []);
  const data = [make("older", "06:00", "07:00"), make("recent", "08:00", "09:00")];
  assert.deepEqual(Array.from(helper.organizeReservations(data, "past", "", now), (item) => item.id), ["recent", "older"]);
});

function cancellationApi({ authenticated = true, owner = "signed-in-user", status = "CONFIRMED", past = false, race = false } = {}) {
  let cancelled = false;
  const updates = [];
  const reservation = { id: "booking", userId: owner, startTime: new Date(past ? "2000-01-01T10:00:00Z" : "2099-01-01T10:00:00Z"), status };
  const prisma = {
    user: { findUnique: async () => ({ id: "signed-in-user" }) },
    reservation: {
      findUnique: async () => ({ ...reservation, status: cancelled ? "CANCELLED" : status }),
      updateMany: async (args) => { updates.push(args); cancelled = !race; return { count: race ? 0 : 1 }; },
    },
  };
  const api = load("../src/app/api/reservations/[id]/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/prisma": { prisma },
    "@/auth": { auth: async () => authenticated ? { user: { email: "user@example.com" } } : null },
  });
  const execute = () => api.PATCH(new Request("http://localhost/api/reservations/booking", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CANCELLED", userId: "browser-supplied-user" }),
  }), { params: Promise.resolve({ id: "booking" }) });
  return { execute, updates };
}
test("cancellation API returns the raw confirmed cancellation and scopes its update to session ownership", async () => {
  const { execute, updates } = cancellationApi();
  const response = await execute();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, "booking");
  assert.equal(result.status, "CANCELLED");
  assert.equal(updates[0].where.userId, "signed-in-user");
  assert.equal(updates[0].where.status, "CONFIRMED");
  assert.ok(updates[0].where.startTime.gt);
});
test("cancellation API rejects signed-out and other-user requests without writing", async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ owner: "another-user" }, 404]]) {
    const { execute, updates } = cancellationApi(options);
    assert.equal((await execute()).status, expected);
    assert.equal(updates.length, 0);
  }
});
test("cancellation API rejects past or cancelled bookings, and handles eligibility races", async () => {
  assert.equal((await cancellationApi({ past: true }).execute()).status, 400);
  assert.equal((await cancellationApi({ status: "CANCELLED" }).execute()).status, 400);
  assert.equal((await cancellationApi({ race: true }).execute()).status, 409);
});
