import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { demoResources, seedResources } from "../prisma/seed-resources.mjs";

const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (name) => imports[name] ?? require(name) });
  return exports;
}
const reservationHelper = load("../src/lib/reservations.ts");
const helper = load("../src/lib/admin-reservations.ts", { "@/lib/reservations": reservationHelper });
const now = Date.parse("2099-01-01T10:00:00Z");
const make = (id, start, end, createdAt, status, name, email) => ({ id, resourceId: id === "b" ? "lab" : "room", startTime: `2099-01-01T${start}:00Z`, endTime: `2099-01-01T${end}:00Z`, createdAt, status, resource: { name: id === "b" ? "Computer Lab" : "Meeting Room", type: "Room", location: "Floor 1" }, user: { name, email } });
const records = [
  make("a", "14:00", "15:00", "2098-12-30T10:00:00Z", "CONFIRMED", "Alice", "alice@example.com"),
  make("b", "11:00", "12:00", "2098-12-31T10:00:00Z", "CONFIRMED", "Bob", "bob@example.com"),
  make("c", "08:00", "09:00", "2098-12-29T10:00:00Z", "CONFIRMED", "Alice", "alice@example.com"),
  make("d", "12:00", "13:00", "2098-12-28T10:00:00Z", "CANCELLED", "Bob", "bob@example.com"),
];
const ids = (filter = "all", search = "", resource = "", sort = "upcoming") => Array.from(helper.filterAdminReservations(records, filter, search, resource, sort, now), (item) => item.id);
test("ADMIN sorting supports upcoming first, newest created, and oldest created", () => {
  assert.deepEqual(ids(), ["b", "a", "c", "d"]);
  assert.deepEqual(ids("all", "", "", "newest"), ["b", "a", "c", "d"]);
  assert.deepEqual(ids("all", "", "", "oldest"), ["d", "c", "a", "b"]);
});
test("ADMIN search matches resource, owner name, and email and combines with resource/status filters", () => {
  assert.deepEqual(ids("upcoming", "  ALICE  "), ["a"]);
  assert.deepEqual(ids("all", "bob@example.com", "lab"), ["b"]);
  assert.deepEqual(ids("all", "computer"), ["b"]);
  assert.deepEqual(ids("past"), ["c"]);
  assert.deepEqual(ids("cancelled"), ["d"]);
  assert.deepEqual(ids("upcoming", "no match"), []);
  assert.equal(records[0].id, "a");
});
function api(role, authenticated = true) {
  const queries = [];
  const prisma = { user: { findUnique: async () => ({ role }) }, reservation: { findMany: async (args) => { queries.push(args); return records; } } };
  const route = load("../src/app/api/admin/reservations/route.ts", { "@/auth": { auth: async () => authenticated ? { user: { email: "account@example.com" } } : null }, "@/lib/prisma": { prisma }, "next/server": { NextResponse: Response } });
  return { GET: route.GET, queries };
}
test("ADMIN API returns all owners with only explicit safe fields and no-store headers", async () => {
  const { GET, queries } = api("ADMIN");
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 4);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(queries[0].where, undefined);
  assert.deepEqual(Object.keys(queries[0].select.user.select).sort(), ["email", "name"]);
});
test("USER and unauthenticated calls cannot query or receive ADMIN reservation data", async () => {
  for (const [role, authenticated, expected] of [["USER", true, 403], ["ADMIN", false, 401]]) {
    const { GET, queries } = api(role, authenticated);
    assert.equal((await GET()).status, expected);
    assert.equal(queries.length, 0);
  }
});
test("ADMIN page rejects USER and signed-out sessions before rendering", async () => {
  for (const [role, authenticated, expected] of [["USER", true, "/"], ["ADMIN", false, "/login"]]) {
    const page = load("../src/app/(dashboard)/admin/reservations/page.tsx", {
      "@/auth": { auth: async () => authenticated ? { user: { email: "account@example.com" } } : null },
      "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ role }) } } },
      "@/components/AdminReservations": { default: () => null },
      "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    }).default;
    await assert.rejects(page(), { message: `REDIRECT:${expected}` });
  }
});
test("demo seed skips existing normalized names, preserves values, and is repeatable", async () => {
  const existing = [{ name: " meeting room a ", capacity: 10 }];
  const calls = [];
  const client = { query: async (sql, args) => {
    calls.push(sql);
    if (sql.startsWith("SELECT name")) return { rows: existing };
    if (sql.startsWith("INSERT")) existing.push({ name: args[1], capacity: args[4] });
    return { rows: [] };
  } };
  assert.deepEqual(await seedResources(client), { inserted: 11, skipped: 1 });
  assert.deepEqual(await seedResources(client), { inserted: 0, skipped: 12 });
  assert.equal(existing.length, 12);
  assert.equal(existing[0].capacity, 10);
  assert.ok(calls.includes('LOCK TABLE public."Resource" IN SHARE ROW EXCLUSIVE MODE'));
  assert.ok(!calls.some((sql) => /^(UPDATE|DELETE|TRUNCATE)/.test(sql)));
  assert.equal(new Set(demoResources.map((item) => item.name)).size, 12);
});
test("demo seed rolls back when an insert fails", async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (sql.startsWith("SELECT")) return { rows: [] };
    if (sql.startsWith("INSERT")) throw new Error("Test insertion error");
    return { rows: [] };
  } };
  await assert.rejects(seedResources(client));
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.includes("COMMIT"));
});
