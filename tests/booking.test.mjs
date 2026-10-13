import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: (name) => imports[name] ?? require(name) });
  return exports;
}
const helpers = load("../src/lib/booking.ts");
const now = new Date("2099-01-01T00:00:00Z");

test("Colombo inputs serialize to exact UTC instants and format back without shifting", () => {
  const time = helpers.parseBookingTime("2099-01-02", "10:00");
  assert.equal(time.toISOString(), "2099-01-02T04:30:00.000Z");
  assert.equal(helpers.colomboDate(time), "2099-01-02");
  assert.equal(helpers.formatBookingTime(time), "10:00 am");
  assert.equal(helpers.formatBookingDate(time), "2 Jan 2099");
});
test("date minimum follows the Colombo day at UTC midnight boundaries", () => {
  assert.equal(helpers.colomboDate(new Date("2026-10-13T18:29:59Z")), "2026-10-13");
  assert.equal(helpers.colomboDate(new Date("2026-10-13T18:30:00Z")), "2026-10-14");
});
test("impossible dates, invalid times, and malformed inputs are rejected", () => {
  for (const [date, time] of [["2099-02-29", "10:00"], ["2099-04-31", "10:00"], ["2099-01-02", "24:00"], ["2099-01-02", "10:60"], ["bad", "10:00"], ["2099-01-02", ""]]) {
    assert.equal(helpers.parseBookingTime(date, time), null);
  }
  assert.ok(helpers.parseBookingTime("2104-02-29", "10:00"));
});
test("required fields and zero-length or reversed same-day ranges are rejected", () => {
  for (const [date, start, end] of [["", "10:00", "11:00"], ["2099-01-02", "", "11:00"], ["2099-01-02", "10:00", ""], ["2099-01-02", "10:00", "10:00"], ["2099-01-02", "12:00", "11:00"]]) {
    assert.equal(helpers.validateBooking(date, start, end, now).ok, false);
  }
});
test("past starts and starts equal to now are rejected, future starts are accepted", () => {
  assert.equal(helpers.validateBooking("2099-01-01", "05:29", "06:00", now).ok, false);
  assert.equal(helpers.validateBooking("2099-01-01", "05:30", "06:00", now).ok, false);
  const result = helpers.validateBooking("2099-01-01", "05:31", "06:00", now);
  assert.equal(result.ok, true);
  assert.equal(result.durationMinutes, 29);
});
test("durations are computed from actual instants and formatted clearly", () => {
  const result = helpers.validateBooking("2099-01-02", "10:00", "11:30", now);
  assert.equal(result.durationMinutes, 90);
  assert.equal(helpers.formatDuration(result.durationMinutes), "1 hr 30 min");
  assert.equal(helpers.formatDuration(60), "1 hr");
  assert.equal(helpers.formatDuration(45), "45 min");
});

const resource = { id: "room", name: "Test Room", type: "Room", location: "North Wing", capacity: 8, isActive: true };
const form = load("../src/components/BookingForm.tsx", {
  "@/lib/booking": helpers,
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
}).default;
test("valid preselection renders real resource details and the Colombo timezone note", () => {
  const html = renderToStaticMarkup(React.createElement(form, { resources: [resource], initialResourceId: "room", today: "2099-01-01" }));
  assert.ok(html.includes('value="room" selected=""'));
  assert.ok(html.includes("North Wing"));
  assert.ok(html.includes("Capacity: 8"));
  assert.ok(html.includes("UTC+05:30"));
  assert.ok(html.includes("Booking summary"));
});
test("invalid preselection is explained and does not select an inactive resource", () => {
  const html = renderToStaticMarkup(React.createElement(form, { resources: [resource], initialResourceId: "inactive", today: "2099-01-01" }));
  assert.ok(html.includes("missing or inactive"));
  assert.ok(!html.includes('value="room" selected=""'));
});
test("no resources renders a helpful empty state without a reservation form", () => {
  const html = renderToStaticMarkup(React.createElement(form, { resources: [], initialResourceId: "", today: "2099-01-01" }));
  assert.ok(html.includes("No active resources to book"));
  assert.ok(html.includes('href="/resources"'));
  assert.ok(!html.includes("<form"));
});
