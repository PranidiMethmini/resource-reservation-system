import { resourceLockModule, withMockTransactions } from "./resource-lock-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, console: { error() {} }, require: (name) => {
    if (imports[name]) return imports[name];
    if (name.startsWith("@/lib/")) return load(`../src/lib/${name.slice(6)}.ts`, imports);
    return require(name);
  } });
  return exports;
}
const authValidation = load("../src/lib/auth-validation.ts");
const validAuth = { name: "Fixture User", email: "fixture@example.com", password: "fixture-password", confirmPassword: "fixture-password" };
test("login requires a valid email and password without checking account existence", () => {
  const errors = authValidation.validateAuthFields("login", { ...validAuth, email: "invalid", password: "" });
  assert.ok(errors.email); assert.ok(errors.password);
  assert.equal(authValidation.loginSchema.safeParse(null).success, false);
});
test("Credentials authorize normalizes email and returns identity only after successful bcrypt comparison", async () => {
  let config;
  const lookups = [];
  const comparisons = [];
  const identity = { id: "admin-fixture", name: "Fixture Admin", email: "fixture@example.com", role: "ADMIN", passwordHash: "opaque-fixture-hash" };
  load("../src/auth.ts", {
    "next-auth": { default: (options) => { config = options; return {}; }, CredentialsSignin: class extends Error {} },
    "@/lib/auth-rate-limit": { checkLoginLimit: async () => ({ allowed: true }) },
    "next-auth/providers/credentials": { default: (options) => options },
    "@/lib/prisma": { prisma: { user: { findUnique: async (args) => { lookups.push(args); return args.where.email === identity.email ? identity : null; } } } },
    "bcryptjs": { default: { compare: async (candidate, stored) => { comparisons.push({ candidate, stored }); return candidate === validAuth.password && stored === identity.passwordHash; } } },
  });
  const authorize = config.providers[0].authorize;
  const result = await authorize({ email: " FIXTURE@EXAMPLE.COM ", password: validAuth.password });
  assert.equal(result.id, identity.id); assert.equal(result.email, identity.email);
  assert.equal(result.passwordHash, undefined);
  assert.equal(lookups[0].where.email, identity.email);
  assert.equal(await authorize({ email: identity.email, password: "wrong-fixture-password" }), null);
  assert.equal(await authorize({ email: "unknown@example.com", password: validAuth.password }), null);
  assert.equal(comparisons.length, 3);
  assert.equal(require("bcryptjs").getRounds(comparisons[2].stored), 12);
  assert.notEqual(comparisons[2].stored, identity.passwordHash);
  const count = lookups.length;
  assert.equal(await authorize({ email: "bad", password: "" }), null);
  assert.equal(lookups.length, count);
});
test("registration enforces name/password limits and matching confirmation", () => {
  for (const change of [{ name: " " }, { name: "x".repeat(101) }, { email: "bad" }, { password: "short" }, { password: "x".repeat(129) }, { confirmPassword: "different" }]) {
    assert.ok(Object.keys(authValidation.validateAuthFields("register", { ...validAuth, ...change })).length);
  }
  const result = authValidation.registerSchema.parse({ ...validAuth, name: " Fixture User ", email: " FIXTURE@EXAMPLE.COM " });
  assert.equal(result.name, "Fixture User"); assert.equal(result.email, "fixture@example.com");
  assert.equal(result.password, validAuth.password);
});
test("new registration rejects bcrypt-truncated passwords, including multibyte input, without restricting legacy login", () => {
  assert.equal(authValidation.registerSchema.safeParse({ ...validAuth, password: "x".repeat(72) }).success, true);
  assert.equal(authValidation.registerSchema.safeParse({ ...validAuth, password: "x".repeat(73) }).success, false);
  assert.equal(authValidation.registerSchema.safeParse({ ...validAuth, password: "\u00e9".repeat(36) }).success, true);
  assert.equal(authValidation.registerSchema.safeParse({ ...validAuth, password: "\u00e9".repeat(37) }).success, false);
  assert.equal(authValidation.registerSchema.safeParse({ ...validAuth, password: "\ud83d\ude00".repeat(19) }).success, false);
  assert.equal(authValidation.loginSchema.safeParse({ email: validAuth.email, password: "x".repeat(128) }).success, true);
});
test("resource frontend limits include description and match PostgreSQL integer range", () => {
  const { validateResource } = load("../src/lib/resource-form.ts");
  const values = { name: "Name", type: "Room", location: "Floor 1", capacity: "5", description: "", isActive: true };
  for (const [field, value] of [["name", " "], ["name", "x".repeat(101)], ["type", "x".repeat(101)], ["location", "x".repeat(201)], ["description", "x".repeat(2001)], ["capacity", "2147483648"]]) {
    assert.ok(validateResource({ ...values, [field]: value })[field]);
  }
});

function harness({ duplicate = false, race = false } = {}) {
  const writes = [];
  const prisma = {
    user: {
      findUnique: async (args) => args.select ? { id: "account", role: "ADMIN" } : duplicate ? { id: "existing" } : null,
      create: async (args) => { if (duplicate || race) throw Object.assign(new Error("Fixture unique conflict"), { code: "P2002" }); writes.push(args); return { id: "new-user", name: args.data.name, email: args.data.email, role: "USER" }; },
    },
    resource: {
      findUnique: async () => ({ id: "resource", isActive: true }),
      create: async (args) => { writes.push(args); return { id: "new-resource", ...args.data }; },
      update: async (args) => { writes.push(args); return { id: "resource", ...args.data }; },
    },
    reservation: {
      findFirst: async () => null,
      findUnique: async () => ({ id: "booking", userId: "account", status: "CONFIRMED", startTime: new Date("2099-01-01T10:00:00Z") }),
      create: async (args) => { writes.push(args); return { id: "booking", ...args.data }; },
      updateMany: async (args) => { writes.push(args); return { count: 1 }; },
    },
  };
  withMockTransactions(prisma);
  const imports = {
    "@/lib/auth-rate-limit": { checkRegistrationLimit: async () => ({ allowed: true }) },
    "@/lib/resource-lock": resourceLockModule,
    "@/auth": { auth: async () => ({ user: { email: "fixture@example.com" } }) }, "@/lib/prisma": { prisma },
    "next/server": { NextResponse: Response }, "bcryptjs": { default: { hash: async (_password, cost) => { assert.equal(cost, 12); return "opaque-fixture-hash"; } } },
  };
  return {
    registration: load("../src/app/api/register/route.ts", imports).POST,
    resourceCreate: load("../src/app/api/resources/route.ts", imports).POST,
    resourceUpdate: load("../src/app/api/resources/[id]/route.ts", imports).PATCH,
    booking: load("../src/app/api/reservations/route.ts", imports).POST,
    cancellation: load("../src/app/api/reservations/[id]/route.ts", imports).PATCH,
    writes,
  };
}
const context = { params: Promise.resolve({ id: "resource" }) };
const request = (method, payload, malformed = false) => new Request("http://localhost/api/fixture", { method, headers: { "Content-Type": "application/json" }, body: malformed ? "{" : JSON.stringify(payload) });
test("all mutation APIs reject malformed JSON and non-object payloads with 400, without writes", async () => {
  const api = harness();
  for (const [handler, method] of [[api.registration, "POST"], [api.resourceCreate, "POST"], [api.resourceUpdate, "PATCH"], [api.booking, "POST"], [api.cancellation, "PATCH"]]) {
    for (const payload of [null, [], "unexpected"]) assert.equal((await handler(request(method, payload), context)).status, 400);
    assert.equal((await handler(request(method, null, true), context)).status, 400);
  }
  assert.equal(api.writes.length, 0);
});
test("registration accepts duplicate and concurrent unique-email submissions without disclosure", async () => {
  const accepted = await harness().registration(request("POST", validAuth));
  const expected = await accepted.json();
  for (const options of [{ duplicate: true }, { race: true }]) {
    const api = harness(options);
    const response = await api.registration(request("POST", validAuth));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), expected);
    assert.equal(response.headers.get("Cache-Control"), accepted.headers.get("Cache-Control"));
    assert.equal(api.writes.length, 0);
  }
});
test("valid registration normalizes email/name, keeps USER role and excludes the hash from the response", async () => {
  const api = harness();
  const response = await api.registration(request("POST", { ...validAuth, name: " Fixture User ", email: " FIXTURE@EXAMPLE.COM ", role: "ADMIN" }));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(api.writes[0].data.role, "USER"); assert.equal(api.writes[0].data.email, "fixture@example.com"); assert.equal(api.writes[0].data.name, "Fixture User");
  assert.equal(data.user, undefined);
  assert.equal(JSON.stringify(data).includes("opaque-fixture-hash"), false);
});
test("registration server rejects missing fields, invalid email and out-of-policy passwords", async () => {
  const api = harness();
  for (const payload of [{}, { ...validAuth, email: "bad" }, { ...validAuth, name: " " }, { ...validAuth, password: "short" }, { ...validAuth, password: "x".repeat(129) }]) {
    assert.equal((await api.registration(request("POST", payload))).status, 400);
  }
  assert.equal(api.writes.length, 0);
});
test("resource APIs reject whitespace, oversized fields and invalid capacities without writing", async () => {
  const api = harness();
  const valid = { name: "Room", type: "Room", location: "Floor 1", capacity: 5, description: "", isActive: true };
  for (const change of [{ name: " " }, { name: "x".repeat(101) }, { type: "x".repeat(101) }, { location: "x".repeat(201) }, { description: "x".repeat(2001) }, { description: {} }, { capacity: 0 }, { capacity: 1.5 }, { capacity: "2" }, { capacity: 2147483648 }]) {
    assert.equal((await api.resourceCreate(request("POST", { ...valid, ...change }))).status, 400);
    assert.equal((await api.resourceUpdate(request("PATCH", { ...valid, ...change }), context)).status, 400);
  }
  assert.equal(api.writes.length, 0);
});
test("booking rejects missing resources, impossible dates and timezone-ambiguous timestamps", async () => {
  const api = harness();
  const valid = { resourceId: "resource", startTime: "2099-01-01T10:00:00Z", endTime: "2099-01-01T11:00:00Z" };
  for (const change of [{ resourceId: " " }, { startTime: "2099-02-30T10:00:00Z" }, { startTime: "2099-01-01T10:00:00" }, { endTime: "invalid" }, { endTime: "2099-01-01T09:00:00Z" }, { startTime: "2000-01-01T10:00:00Z" }]) {
    assert.equal((await api.booking(request("POST", { ...valid, ...change }))).status, 400);
  }
  assert.equal(api.writes.length, 0);
});
test("unexpected search/filter/sort inputs fall back safely without restricting normal text", () => {
  const resource = { id: "r", name: "A [Room]", type: "Room", location: "Floor 1", capacity: 5, description: null, isActive: true };
  const catalog = load("../src/lib/resource-catalog.ts");
  assert.equal(catalog.filterResources([resource], { search: null, type: null, status: "unexpected" }).length, 1);
  assert.equal(catalog.filterResources([resource], { search: "[room]", type: "", status: "all" }).length, 1);
  const item = { id: "booking", resourceId: "r", resource, user: { name: "Fixture", email: "fixture@example.com" }, createdAt: "2098-01-01T00:00:00Z", startTime: "2099-01-01T10:00:00Z", endTime: "2099-01-01T11:00:00Z", status: "CONFIRMED" };
  const reservations = load("../src/lib/reservations.ts");
  assert.equal(reservations.organizeReservations([item], "bad", null, 0).length, 1);
  const admin = load("../src/lib/admin-reservations.ts");
  assert.equal(admin.filterAdminReservations([item], "bad", null, null, "bad", 0).length, 1);
});
