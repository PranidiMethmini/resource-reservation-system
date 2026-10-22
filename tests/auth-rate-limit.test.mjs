import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { CredentialsSignin } from "@auth/core/errors";
import { Auth } from "@auth/core";
import Credentials from "@auth/core/providers/credentials";
import { signIn } from "next-auth/react";
import { Ratelimit as InstalledRatelimit } from "@upstash/ratelimit";
import ts from "typescript";

const require = createRequire(import.meta.url);
const env = {
  NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production",
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "mock-only-token",
  RATE_LIMIT_KEY_SECRET: "mock-only-hmac-key-with-at-least-32-characters",
};
function load(path, imports = {}, environment = env, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, {
    exports, URL, Request, Response, Headers, AbortSignal, Date, setTimeout, clearTimeout,
    process: { env: environment }, console: { error() {} },
    ...globals,
    require: (name) => imports[name] ?? (name.startsWith("@/lib/")
      ? load(`../src/lib/${name.slice(6)}.ts`, imports, environment) : require(name)),
  });
  return exports;
}
const responses = load("../src/lib/auth-rate-limit-response.ts");
const request = (ip = "192.0.2.1", extra = {}) => new Request("https://reservehub.example/api/auth/callback/credentials", {
  method: "POST", headers: { ...(ip === null ? {} : { "x-vercel-forwarded-for": ip }), ...extra },
});

// Model one shared atomic Redis operation. Separate module instances share this
// external backend; the application must not keep authoritative local counters.
function backend() {
  const calls = [], configs = [], clients = [], counters = new Map();
  let mode = "normal", resetOffset = 60_000;
  class MockRedis { constructor(options) { clients.push(options); } }
  class MockRatelimit {
    static slidingWindow(tokens, duration) { return { tokens, duration }; }
    constructor(config) { this.config = config; configs.push(config); }
    async limit(id) {
      const { prefix, limiter } = this.config;
      calls.push({ prefix, id });
      if (mode === "error" || mode === "quota") throw new Error(`mock ${mode}: private provider details`);
      if (mode === "hang") return new Promise(() => {});
      const key = `${prefix}:${id}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count); // atomic, before yielding to another caller
      return {
        success: mode === "timeout" || mode === "malformed" || count <= limiter.tokens,
        limit: limiter.tokens,
        remaining: Math.max(0, limiter.tokens - count),
        reset: mode === "malformed" ? NaN : Date.now() + resetOffset,
        pending: mode === "pending-error" ? Promise.reject(new Error("mock background failure")) : Promise.resolve(),
        ...(mode === "timeout" ? { reason: "timeout" } : {}),
      };
    }
  }
  return {
    calls, configs, clients, counters,
    setMode(value) { mode = value; },
    setResetOffset(value) { resetOffset = value; },
    module(environment = env) {
      return load("../src/lib/auth-rate-limit.ts", {
        "@upstash/redis": { Redis: MockRedis }, "@upstash/ratelimit": { Ratelimit: MockRatelimit },
      }, environment);
    },
  };
}

test("login allows attempt 30 per IP and blocks 31, across module instances", async () => {
  const db = backend(), a = db.module(), b = db.module();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    (i % 2 ? a : b).checkLoginLimit(request(), `person-${i}@example.test`)));
  assert.equal(results.filter(r => r.allowed).length, 30);
  assert.equal(results.filter(r => r.status === 429).length, 10);
  assert.equal(db.calls.filter(c => c.prefix.endsWith(":loginIp")).length, 40);
});

test("email limit is shared across IPs; normalization allows 10 and blocks 11", async () => {
  const db = backend(), a = db.module(), b = db.module();
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
    (i % 2 ? a : b).checkLoginLimit(request(`192.0.2.${i + 1}`), i % 2 ? " PERSON@EXAMPLE.TEST " : "person@example.test")));
  assert.equal(results.filter(r => r.allowed).length, 10);
  assert.equal(results.filter(r => r.status === 429).length, 6);
  const keys = db.calls.filter(c => c.prefix.endsWith(":loginEmail")).map(c => c.id);
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], createHmac("sha256", env.RATE_LIMIT_KEY_SECRET).update("email:person@example.test").digest("hex"));
});

test("registration allows 5 and rejects 6 without any account lookup", async () => {
  const db = backend(), limiter = db.module();
  const results = await Promise.all(Array.from({ length: 9 }, () => limiter.checkRegistrationLimit(request())));
  assert.equal(results.filter(r => r.allowed).length, 5);
  assert.equal(results.filter(r => r.status === 429).length, 4);
});

test("installed Upstash SDK uses one atomic script operation per decision across clients", async () => {
  const counters = new Map(), calls = [];
  class Redis {
    async evalsha(hash, keys, args) {
      assert.match(hash, /^[a-f0-9]{40}$/);
      assert.equal(keys.length, 2); // current and previous weighted windows
      const [tokens, now, duration, increment] = args;
      assert.equal(tokens, 5); assert.equal(duration, 3_600_000); assert.equal(increment, 1);
      assert.equal(Number.isSafeInteger(now), true);
      const key = keys[0].replace(/:\d+$/, "");
      calls.push(key);
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return [count > tokens ? -1 : tokens - count, tokens];
    }
  }
  const imports = { "@upstash/redis": { Redis }, "@upstash/ratelimit": { Ratelimit: InstalledRatelimit } };
  const a = load("../src/lib/auth-rate-limit.ts", imports), b = load("../src/lib/auth-rate-limit.ts", imports);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).checkRegistrationLimit(request())));
  assert.equal(results.filter(r => r.allowed).length, 5);
  assert.equal(results.filter(r => r.status === 429).length, 3);
  assert.equal(calls.length, 8); assert.equal(new Set(calls).size, 1);
});

test("retry hints use Redis reset metadata and remain bounded", async () => {
  const db = backend(), limiter = db.module();
  for (let i = 0; i < 5; i++) await limiter.checkRegistrationLimit(request());
  const ordinary = await limiter.checkRegistrationLimit(request());
  assert.ok(ordinary.retryAfter >= 59 && ordinary.retryAfter <= 60);
  db.setResetOffset(-1000);
  assert.equal((await limiter.checkRegistrationLimit(request())).retryAfter, 1);
  db.setResetOffset(7_200_000);
  assert.equal((await limiter.checkRegistrationLimit(request())).retryAfter, 3600);
});

test("invalid identities are counted too; SDK policies are shared and privacy preserving", async () => {
  const db = backend(), limiter = db.module();
  for (let i = 0; i < 11; i++) {
    const result = await limiter.checkLoginLimit(request(), " NOT-AN-EMAIL ");
    assert.equal(result.allowed, i < 10);
  }
  assert.deepEqual(db.configs.map(c => [c.limiter.tokens, c.limiter.duration]), [[30, "10 m"], [10, "15 m"], [5, "1 h"]]);
  for (const config of db.configs) {
    assert.equal(config.ephemeralCache, false); assert.equal(config.analytics, false);
    assert.equal(config.enableProtection, false); assert.equal(config.timeout, 1000);
  }
  for (const call of db.calls) {
    assert.match(call.id, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(call).includes("192.0.2.1"), false);
    assert.equal(JSON.stringify(call).includes("not-an-email"), false);
  }
  assert.equal(db.clients[0].retry.retries, 0);
  assert.equal(db.clients[0].enableTelemetry, false);
  assert.equal(db.clients[0].enableAutoPipelining, false);
  assert.equal(db.clients[0].signal() instanceof AbortSignal, true);
});

test("equivalent IPv6 and mapped IPv4 forms share canonical identifiers", () => {
  const limiter = backend().module();
  assert.equal(limiter.trustedClientIp(request("2001:0db8:0000:0000:0000:0000:0000:0001")), "2001:db8::1");
  assert.equal(limiter.trustedClientIp(request("::ffff:192.0.2.1")), "192.0.2.1");
});

test("missing/invalid platform metadata fails closed; arbitrary forwarding headers cannot supply an IP", async () => {
  for (const ip of [null, "invalid", "192.0.2.1, 192.0.2.2", "192.0.2.1:1234", "[2001:db8::1]", "fe80::1%eth0"]) {
    const db = backend(), limiter = db.module();
    const req = request(ip, { "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" });
    assert.equal((await limiter.checkLoginLimit(req, "person@example.test")).status, 503);
    assert.equal((await limiter.checkRegistrationLimit(req)).status, 503);
    assert.equal(db.calls.length, 0);
  }
  const db = backend(), untrustedHost = db.module({ ...env, VERCEL: undefined });
  assert.equal((await untrustedHost.checkLoginLimit(request(), "person@example.test")).status, 503);
  assert.equal(db.calls.length, 0);
});

test("spoofed non-platform headers do not change a valid Vercel client identifier", async () => {
  const db = backend(), limiter = db.module();
  await limiter.checkRegistrationLimit(request("192.0.2.1", { "x-forwarded-for": "198.51.100.1" }));
  await limiter.checkRegistrationLimit(request("192.0.2.1", { "x-forwarded-for": "198.51.100.2" }));
  assert.equal(db.calls[0].id, db.calls[1].id);
});

test("local development uses one loopback bucket and still requires Redis", async () => {
  const db = backend(), limiter = db.module({ ...env, NODE_ENV: "development", VERCEL: undefined, VERCEL_ENV: undefined });
  assert.equal(limiter.trustedClientIp(new Request("http://localhost/api/register", { headers: { "x-vercel-forwarded-for": "198.51.100.2" } })), "127.0.0.1");
  assert.equal((await limiter.checkRegistrationLimit(new Request("http://localhost/api/register"))).allowed, true);
  assert.equal(db.calls.length, 1);
});

test("production and preview namespaces do not consume each other's quotas", async () => {
  const db = backend(), prod = db.module(), preview = db.module({ ...env, VERCEL_ENV: "preview" });
  for (let i = 0; i < 5; i++) await prod.checkRegistrationLimit(request());
  assert.equal((await prod.checkRegistrationLimit(request())).status, 429);
  assert.equal((await preview.checkRegistrationLimit(request())).allowed, true);
});

test("missing or invalid configuration fails closed before contacting Redis", async () => {
  for (const change of [
    { RATE_LIMIT_KEY_SECRET: undefined }, { RATE_LIMIT_KEY_SECRET: "short" },
    { UPSTASH_REDIS_REST_TOKEN: undefined }, { UPSTASH_REDIS_REST_URL: undefined },
    { UPSTASH_REDIS_REST_URL: "http://redis.example.invalid" }, { VERCEL_ENV: "arbitrary" },
    { VERCEL_ENV: undefined }, { VERCEL_ENV: "local" },
  ]) {
    const db = backend(), limiter = db.module({ ...env, ...change });
    assert.equal((await limiter.checkRegistrationLimit(request())).status, 503);
    assert.equal(db.calls.length, 0);
  }
});

test("standalone development cannot consume the production namespace through an environment label", async () => {
  const db = backend();
  const limiter = db.module({ ...env, NODE_ENV: "development", VERCEL: undefined });
  assert.equal((await limiter.checkRegistrationLimit(new Request("http://localhost/api/register"))).allowed, true);
  assert.match(db.calls[0].prefix, /:local:/);
});

test("malformed success metadata cannot grant permission", async () => {
  const good = { success: true, reset: Date.now() + 60_000, limit: 5, remaining: 4, pending: Promise.resolve() };
  for (const change of [{ limit: undefined }, { remaining: undefined }, { limit: 0 }, { remaining: -1 }, { remaining: 6 }, { remaining: 0.5 }, { reset: 0 }, { success: false }]) {
    class Redis {}
    class Ratelimit {
      static slidingWindow() { return {}; }
      async limit() { return { ...good, ...change }; }
    }
    const limiter = load("../src/lib/auth-rate-limit.ts", { "@upstash/redis": { Redis }, "@upstash/ratelimit": { Ratelimit } });
    assert.equal((await limiter.checkRegistrationLimit(request())).status, 503);
  }
});

test("Auth.js logging cannot print credential-bearing errors or causes", () => {
  let config;
  const logs = [];
  load("../src/auth.ts", {
    "next-auth": { default: options => { config = options; return {}; }, CredentialsSignin },
    "next-auth/providers/credentials": { default: options => options },
    "@/lib/auth-rate-limit": { checkLoginLimit: async () => ({ allowed: true }) },
    "@/lib/prisma": { prisma: {} },
  }, env, { console: { error: (...args) => logs.push(args) } });
  config.logger.error(Object.assign(new Error("mock-private-password-and-token"), { cause: { body: { password: "mock-private-password-and-token" } } }));
  assert.equal(config.debug, false);
  assert.equal(JSON.stringify(logs).includes("mock-private-password-and-token"), false);
  assert.equal(logs.length, 1);
});

test("the public timing-only hash can never authenticate a missing user", async () => {
  let config, comparedHash;
  load("../src/auth.ts", {
    "next-auth": { default: options => { config = options; return {}; }, CredentialsSignin },
    "next-auth/providers/credentials": { default: options => options },
    "@/lib/auth-rate-limit": { checkLoginLimit: async () => ({ allowed: true }) },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => null } } },
    "bcryptjs": { default: { compare: async (_password, hash) => { comparedHash = hash; return true; } } },
  });
  assert.equal(await config.providers[0].authorize({ email: "missing@example.test", password: "mock-only" }, request()), null);
  assert.equal(require("bcryptjs").getRounds(comparedHash), 12);
});

test("registration hashes new, duplicate and racing submissions and returns identical public responses", async () => {
  const replies = [];
  for (const duplicate of [false, true, true]) {
    const calls = [];
    const route = load("../src/app/api/register/route.ts", {
      "next/server": { NextResponse: Response },
      "@/lib/auth-rate-limit": { checkRegistrationLimit: async () => ({ allowed: true }) },
      "bcryptjs": { default: { hash: async (_password, cost) => { assert.equal(cost, 12); calls.push("hash"); return "mock-only-hash"; } } },
      "@/lib/prisma": { prisma: { user: {
        create: async args => {
          calls.push("create"); assert.equal(args.data.role, "USER");
          if (duplicate) throw Object.assign(new Error("mock-private-db-details"), { code: "P2002" });
          return { id: "mock-new-user" };
        },
      } } },
    });
    const response = await route.POST(new Request("https://reservehub.example/api/register", {
      method: "POST", body: JSON.stringify({ name: "Fixture Person", email: " PERSON@EXAMPLE.TEST ", password: "mock-only-password" }),
    }));
    assert.deepEqual(calls, ["hash", "create"]);
    replies.push({ status: response.status, body: await response.json(), cache: response.headers.get("Cache-Control") });
  }
  assert.deepEqual(replies[1], replies[0]); assert.deepEqual(replies[2], replies[0]);
  assert.equal(replies[0].status, 201); assert.equal(replies[0].body.user, undefined);
});

test("React authentication form displays throttle/outage errors without retrying or navigating", async () => {
  for (const mode of ["login", "register"]) for (const status of [429, 503]) {
    const updates = [], navigation = [];
    let attempts = 0;
    const element = (type, props) => ({ type, props });
    const mod = load("../src/components/AuthForm.tsx", {
      "react": {
        useEffect() {}, useRef: value => ({ current: value }),
        useState: value => [typeof value === "object" && value?.password === "" ? { name: "Fixture Person", email: "person@example.test", password: "mock-only-password", confirmPassword: "mock-only-password" } : value, next => updates.push(next)],
      },
      "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
      "next/link": { default: "link" },
      "next/navigation": { useRouter: () => ({ replace: path => navigation.push(path), refresh: () => navigation.push("refresh") }) },
      "next-auth/react": { signIn: async () => { attempts++; return { status, ok: false, error: "CredentialsSignin" }; } },
    }, env, { fetch: async () => { attempts++; return Response.json({}, { status }); } });
    function findForm(node) {
      if (node?.type === "form") return node;
      const children = node?.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) { const found = child && typeof child === "object" ? findForm(child) : null; if (found) return found; }
      return null;
    }
    const form = findForm(mod.default({ mode }));
    assert.ok(form);
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(attempts, 1); assert.equal(navigation.length, 0);
    assert.ok(updates.some(value => typeof value === "string" && value.includes(status === 429 ? "Too many" : "temporarily unavailable")));
  }
});

for (const failure of ["timeout", "error", "quota", "pending-error", "malformed", "hang"]) {
  test(`Redis ${failure} fails closed with a bounded, sanitized 503`, async () => {
    const db = backend(), limiter = db.module(); db.setMode(failure);
    const result = await limiter.checkRegistrationLimit(request());
    assert.equal(result.allowed, false); assert.equal(result.status, 503); assert.equal(result.retryAfter, 60);
    assert.equal(JSON.stringify(result).includes("private provider details"), false);
  });
}

function authHarness(result) {
  let config, lookups = 0, comparisons = 0;
  const emails = [];
  load("../src/auth.ts", {
    "next-auth": { default: options => { config = options; return {}; }, CredentialsSignin },
    "next-auth/providers/credentials": { default: options => options },
    "@/lib/auth-rate-limit": { checkLoginLimit: async (_req, email) => { emails.push(email); return result; } },
    "@/lib/auth-rate-limit-response": responses,
    "@/lib/prisma": { prisma: { user: { findUnique: async () => { lookups++; return null; } } } },
    "bcryptjs": { default: { compare: async () => { comparisons++; return false; } } },
  });
  return { config, emails, counts: () => ({ lookups, comparisons }) };
}

test("credentials limits run for valid and invalid input before Prisma or bcrypt", async () => {
  for (const status of [429, 503]) {
    const h = authHarness({ allowed: false, status, retryAfter: 60 });
    for (const credentials of [{ email: "person@example.test", password: "candidate" }, { email: "bad", password: "" }]) {
      await assert.rejects(h.config.providers[0].authorize(credentials, request()), error => {
        assert.ok(error instanceof CredentialsSignin);
        assert.equal(responses.parseAuthLimitCode(error.code).status, status);
        return true;
      });
    }
    assert.deepEqual(h.counts(), { lookups: 0, comparisons: 0 });
    assert.equal(h.config.session.strategy, "jwt");
  }
});

function authErrorResponse(status, json = true) {
  const url = `https://reservehub.example/login?error=CredentialsSignin&code=${status === 429 ? "rate_limited" : "rate_unavailable"}_60`;
  return json ? Response.json({ url }) : Response.redirect(url, 302);
}

test("callback preserves Auth.js JSON envelope, redirects, cookies and retry headers", async () => {
  for (const status of [429, 503]) {
    const response = authErrorResponse(status);
    response.headers.append("Set-Cookie", "authjs.csrf-token=mock-only; HttpOnly");
    const wrapped = await responses.authRateLimitResponse(request("192.0.2.1", { "X-Auth-Return-Redirect": "1" }), response, { allowed: false, status, retryAfter: 60 });
    assert.equal(wrapped.status, status); assert.equal(wrapped.headers.get("Retry-After"), "60");
    assert.equal(wrapped.headers.get("Cache-Control"), "private, no-store");
    assert.ok(wrapped.headers.get("Set-Cookie")); assert.ok((await wrapped.json()).url);
    const native = await responses.authRateLimitResponse(request(), authErrorResponse(status, false), { allowed: false, status, retryAfter: 60 });
    assert.equal(native.status, 302); assert.ok(native.headers.get("Location"));
    assert.equal(native.headers.get("Retry-After"), "60");
  }
});

test("installed NextAuth React signIn client accepts actual wrapped 429/503 responses", async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  try {
    globalThis.window = { location: { href: "https://reservehub.example/login" } };
    for (const status of [429, 503]) {
      globalThis.fetch = async (input, options) => {
        if (String(input).endsWith("/providers")) return Response.json({ credentials: { id: "credentials", type: "credentials" } });
        if (String(input).endsWith("/csrf")) return Response.json({ csrfToken: "mock-only-csrf" });
        assert.ok(String(input).includes("/callback/credentials"));
        return responses.authRateLimitResponse(request("192.0.2.1", options.headers), authErrorResponse(status), { allowed: false, status, retryAfter: 60 });
      };
      const result = await signIn("credentials", { email: "person@example.test", password: "mock-only", redirect: false });
      assert.equal(result.status, status); assert.equal(result.ok, false);
      assert.equal(result.error, "CredentialsSignin"); assert.ok(responses.parseAuthLimitCode(result.code));
      assert.equal(result.url, null);
      await signIn("credentials", { email: "person@example.test", password: "mock-only", redirect: true });
      const destination = new URL(globalThis.window.location.href);
      assert.equal(destination.pathname, "/login");
      assert.equal(responses.parseAuthLimitCode(destination.searchParams.get("code")).status, status);
    }
  } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
});

test("installed Auth.js core serializes real provider throttle errors after CSRF validation", async () => {
  for (const status of [429, 503]) {
    const h = authHarness({ allowed: false, status, retryAfter: 60 });
    const config = {
      basePath: "/api/auth", trustHost: true, secret: "mock-only-auth-secret-for-offline-unit-tests",
      providers: [Credentials({ authorize: h.config.providers[0].authorize })],
      pages: { signIn: "/login" }, logger: { error() {}, warn() {} },
    };
    const csrf = await Auth(new Request("https://reservehub.example/api/auth/csrf"), config);
    const { csrfToken } = await csrf.json();
    const cookies = csrf.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    const req = new Request("https://reservehub.example/api/auth/callback/credentials", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1", Cookie: cookies },
      body: new URLSearchParams({ csrfToken, email: "person@example.test", password: "mock-only" }),
    });
    const result = await responses.withAuthRateLimitResponse(req, () => Auth(req, config));
    assert.equal(result.status, status); assert.equal(result.headers.get("Retry-After"), "60");
    const url = new URL((await result.json()).url);
    assert.equal(url.pathname, "/login"); assert.equal(url.searchParams.get("error"), "CredentialsSignin");
    assert.deepEqual(h.counts(), { lookups: 0, comparisons: 0 });
  }
});

test("concurrent Auth.js requests keep denial metadata isolated; callback URLs cannot forge a denial", async () => {
  const req = request("192.0.2.1", { "X-Auth-Return-Redirect": "1" });
  const results = await Promise.all([429, 503].map(status => responses.withAuthRateLimitResponse(req, async () => {
    responses.recordAuthLimitFailure({ allowed: false, status, retryAfter: 60 });
    await new Promise(resolve => setTimeout(resolve, status === 429 ? 10 : 1));
    return authErrorResponse(status);
  })));
  assert.deepEqual(results.map(r => r.status), [429, 503]);
  const successfulCallback = authErrorResponse(429);
  assert.equal(await responses.withAuthRateLimitResponse(req, async () => successfulCallback), successfulCallback);
  assert.equal(successfulCallback.status, 200);
});

test("session, signout, successful login, and ordinary credential errors are untouched", async () => {
  let postCalls = 0;
  const route = load("../src/app/api/auth/[...nextauth]/route.ts", {
    "@/auth": { handlers: { GET: async () => Response.json({ session: true }), POST: async () => { postCalls++; return Response.json({ url: "https://reservehub.example/" }); } } },
  });
  assert.equal((await route.GET()).status, 200);
  for (const action of ["signout", "session", "callback/credentials"]) {
    const req = new Request(`https://reservehub.example/api/auth/${action}`, { method: "POST", headers: { "X-Auth-Return-Redirect": "1" } });
    assert.equal((await route.POST(req)).status, 200);
  }
  assert.equal(postCalls, 3);
  const ordinary = Response.json({ url: "https://reservehub.example/login?error=CredentialsSignin&code=credentials" });
  assert.equal(await responses.authRateLimitResponse(request(null, { "X-Auth-Return-Redirect": "1" }), ordinary), ordinary);
  for (const code of ["rate_limited_0", "rate_limited_99999", "rate_limited_3601", "rate_limited_x", "credentials"]) assert.equal(responses.parseAuthLimitCode(code), null);
});

test("registration stops before parsing, hashing or DB work when blocked/unavailable", async () => {
  for (const status of [429, 503]) {
    const route = load("../src/app/api/register/route.ts", {
      "next/server": { NextResponse: Response },
      "@/lib/auth-rate-limit": { checkRegistrationLimit: async () => ({ allowed: false, status, retryAfter: 60 }) },
      "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("DB must not be reached"); } }) },
      "bcryptjs": { default: { hash() { throw new Error("bcrypt must not be reached"); } } },
    });
    const response = await route.POST(request());
    assert.equal(response.status, status); assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});

test("catalog rejects anonymous/deleted users, preserves signed-in active and inactive resources", async () => {
  for (const identity of ["anonymous", "deleted", "USER", "ADMIN"]) {
    let catalogQueries = 0;
    const resources = [{ id: "active", isActive: true }, { id: "inactive", isActive: false }];
    const route = load("../src/app/api/resources/route.ts", {
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => identity === "anonymous" ? null : { user: { email: "person@example.test" } } },
      "@/lib/prisma": { prisma: {
        user: { findUnique: async () => identity === "deleted" ? null : { id: "user", role: identity } },
        resource: { findMany: async args => { assert.equal(args.where, undefined); catalogQueries++; return resources; } },
      } },
    });
    const response = await route.GET();
    assert.equal(response.status, ["USER", "ADMIN"].includes(identity) ? 200 : 401);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(catalogQueries, response.status === 200 ? 1 : 0);
    if (response.status === 200) assert.deepEqual(await response.json(), resources);
  }
});
