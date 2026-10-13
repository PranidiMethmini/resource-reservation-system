import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadModule(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (name) => imports[name] ?? require(name) });
  return exports;
}
const helper = loadModule("../src/lib/resource-catalog.ts");
const catalog = loadModule("../src/components/ResourceCatalog.tsx", {
  "@/lib/resource-catalog": helper,
  "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
}).default;
const resources = [
  { id: "active-room", name: "Meeting Room A", type: "Room", location: "North Wing", capacity: 8, description: "A room for meetings.", isActive: true },
  { id: "inactive-lab", name: "Computer Lab", type: "Laboratory", location: "South Wing", capacity: 20, description: null, isActive: false },
  { id: "active-room-b", name: "Meeting Room B", type: "Room", location: "South Wing", capacity: 6, description: null, isActive: true },
];
const defaults = { search: "", type: "", status: "all" };
const ids = (filters = {}, source = resources) => Array.from(helper.filterResources(source, { ...defaults, ...filters }), (item) => item.id);

test("all filters cleared preserve every resource and original order", () => {
  assert.deepEqual(ids(), resources.map((item) => item.id));
});
test("search matches name, type, and location, ignoring case and outer whitespace", () => {
  assert.deepEqual(ids({ search: "  MEETING ROOM A  " }), ["active-room"]);
  assert.deepEqual(ids({ search: "laboratory" }), ["inactive-lab"]);
  assert.deepEqual(ids({ search: "south" }), ["inactive-lab", "active-room-b"]);
});
test("type and active/inactive status filters work independently", () => {
  assert.deepEqual(ids({ type: "Room" }), ["active-room", "active-room-b"]);
  assert.deepEqual(ids({ status: "active" }), ["active-room", "active-room-b"]);
  assert.deepEqual(ids({ status: "inactive" }), ["inactive-lab"]);
});
test("search, type, and status combine using AND", () => {
  assert.deepEqual(ids({ search: "south", type: "Room", status: "active" }), ["active-room-b"]);
  assert.deepEqual(ids({ type: "Room", status: "inactive" }), []);
});
test("empty catalogs and searches without matches return no results", () => {
  assert.deepEqual(ids({}, []), []);
  assert.deepEqual(ids({ search: "nonexistent" }), []);
  assert.deepEqual(ids({ search: "[.*" }), []);
  assert.equal(resources.length, 3);
});
test("USER rendering hides edit links and only active cards have booking links", () => {
  const html = renderToStaticMarkup(React.createElement(catalog, { resources, isAdmin: false }));
  assert.ok(html.includes("/book?resourceId=active-room"));
  assert.ok(!html.includes("/book?resourceId=inactive-lab"));
  assert.ok(html.includes("Unavailable for booking"));
  assert.ok(!html.includes("Edit Resource"));
  assert.ok(html.includes("3</span> matching"));
});
test("ADMIN rendering includes edit links for active and inactive resources", () => {
  const html = renderToStaticMarkup(React.createElement(catalog, { resources, isAdmin: true }));
  assert.ok(html.includes("/admin/resources/active-room/edit"));
  assert.ok(html.includes("/admin/resources/inactive-lab/edit"));
});
test("empty-catalog state only offers Add New Resource to ADMIN", () => {
  const admin = renderToStaticMarkup(React.createElement(catalog, { resources: [], isAdmin: true }));
  const user = renderToStaticMarkup(React.createElement(catalog, { resources: [], isAdmin: false }));
  assert.ok(admin.includes("/admin/resources/new"));
  assert.ok(!user.includes("/admin/resources/new"));
});

function loadPage({ role = "USER", authenticated = true, fail = false } = {}) {
  const queries = [];
  const page = loadModule("../src/app/(dashboard)/resources/page.tsx", {
    "@/auth": { auth: async () => authenticated ? { user: { email: "signed-in@example.com" } } : null },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async (args) => { queries.push(args); return { role }; } },
      resource: { findMany: async (args) => {
        queries.push(args);
        if (fail) throw new Error("Test database failure");
        return resources;
      } },
    } },
    "@/components/ResourceCatalog": { default: catalog },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
  }).default;
  return { page, queries };
}

for (const role of ["ADMIN", "USER"]) {
  test(`${role} server page integrates the catalog with session-derived role and correct controls`, async () => {
    const { page, queries } = loadPage({ role });
    const html = renderToStaticMarkup(await page());
    assert.equal(queries[0].where.email, "signed-in@example.com");
    assert.equal(queries[0].select.role, true);
    assert.equal(queries[1].orderBy.createdAt, "desc");
    assert.ok(html.includes('id="resource-search"'));
    assert.ok(html.includes("Meeting Room A"));
    assert.equal(html.includes("/admin/resources/new"), role === "ADMIN");
    assert.equal(html.includes("/admin/resources/active-room/edit"), role === "ADMIN");
    assert.ok(html.includes("/book?resourceId=active-room"));
    assert.ok(!html.includes("/book?resourceId=inactive-lab"));
  });
}

test("signed-out server page redirects before querying or rendering resource data", async () => {
  const { page, queries } = loadPage({ authenticated: false });
  await assert.rejects(page(), { message: "REDIRECT:/login" });
  assert.equal(queries.length, 0);
});

test("query failures show an error rather than an empty catalog or admin controls", async () => {
  const { page } = loadPage({ role: "ADMIN", fail: true });
  const html = renderToStaticMarkup(await page());
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes("refresh the page"));
  assert.ok(!html.includes('id="resource-search"'));
  assert.ok(!html.includes("/admin/resources/new"));
});
