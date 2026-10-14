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
  runInNewContext(code, { exports, console: { error() {} }, require: (name) => imports[name] ?? require(name) });
  return exports;
}
const validation = load("../src/lib/resource-form.ts");
const values = { name: " Room A ", type: " Meeting Room ", location: " Floor 2 ", capacity: "12", description: " Description ", isActive: true };
test("valid resource details normalize to existing API field names", () => {
  assert.equal(Object.keys(validation.validateResource(values)).length, 0);
  const payload = validation.resourcePayload(values);
  assert.equal(payload.name, "Room A");
  assert.equal(payload.type, "Meeting Room");
  assert.equal(payload.location, "Floor 2");
  assert.equal(payload.capacity, 12);
  assert.equal(payload.description, "Description");
  assert.equal(payload.isActive, true);
});
test("all required text fields reject whitespace-only values", () => {
  const errors = validation.validateResource({ ...values, name: " ", type: "", location: "  " });
  assert.ok(errors.name); assert.ok(errors.type); assert.ok(errors.location);
});
test("capacity rejects empty, zero, negative, fractional, invalid, and overflowing integers", () => {
  for (const capacity of ["", " ", "0", "-1", "1.5", "abc", "Infinity", "2147483648"]) {
    assert.ok(validation.validateResource({ ...values, capacity }).capacity);
  }
  assert.equal(validation.validateResource({ ...values, capacity: "1" }).capacity, undefined);
});
test("optional descriptions and inactive edit values remain supported", () => {
  const input = { ...values, description: "", isActive: false };
  assert.equal(Object.keys(validation.validateResource(input)).length, 0);
  assert.equal(validation.resourcePayload(input).description, "");
  assert.equal(validation.resourcePayload(input).isActive, false);
});

function endpoints({ authenticated = true, role = "ADMIN" } = {}) {
  const writes = [];
  const resource = { id: "resource", name: "Room A", type: "Room", location: "Floor 2", capacity: 12, description: null, isActive: true };
  const prisma = {
    user: { findUnique: async () => authenticated ? { id: "account", role } : null },
    resource: {
      findUnique: async () => resource,
      create: async (args) => { writes.push(args); return { ...resource, ...args.data }; },
      update: async (args) => { writes.push(args); return { ...resource, ...args.data }; },
    },
  };
  withMockTransactions(prisma);
  const imports = {
    "@/lib/resource-lock": resourceLockModule,
    "next/server": { NextResponse: Response }, "@/lib/prisma": { prisma },
    "@/auth": { auth: async () => authenticated ? { user: { email: "admin@example.com" } } : null },
  };
  const create = load("../src/app/api/resources/route.ts", imports).POST;
  const update = load("../src/app/api/resources/[id]/route.ts", imports);
  const request = (method, body = {}) => new Request("http://localhost/api/resources/resource", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const context = { params: Promise.resolve({ id: "resource" }) };
  return {
    create: (body) => create(request("POST", body)),
    patch: (body) => update.PATCH(request("PATCH", body), context),
    deactivate: () => update.DELETE(request("DELETE"), context),
    writes,
  };
}
test("signed-out callers receive 401 from create, update, and deactivate without writes", async () => {
  const api = endpoints({ authenticated: false });
  assert.equal((await api.create(values)).status, 401);
  assert.equal((await api.patch(values)).status, 401);
  assert.equal((await api.deactivate()).status, 401);
  assert.equal(api.writes.length, 0);
});
test("USER callers receive 403 from every resource mutation without writes", async () => {
  const api = endpoints({ role: "USER" });
  assert.equal((await api.create({ ...values, role: "ADMIN" })).status, 403);
  assert.equal((await api.patch(values)).status, 403);
  assert.equal((await api.deactivate()).status, 403);
  assert.equal(api.writes.length, 0);
});
test("ADMIN update accepts normalized details and rejects fractional capacity", async () => {
  const api = endpoints();
  const payload = validation.resourcePayload(values);
  assert.equal((await api.patch({ ...payload, capacity: 1.5 })).status, 400);
  assert.equal(api.writes.length, 0);
  const response = await api.patch(payload);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "Room A");
});
test("ADMIN deactivation only updates isActive and returns the existing response shape", async () => {
  const api = endpoints();
  const response = await api.deactivate();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.resource.id, "resource");
  assert.equal(result.resource.isActive, false);
  assert.equal(Object.keys(api.writes[0].data).join(","), "isActive");
});
