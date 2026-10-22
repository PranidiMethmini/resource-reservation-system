import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import type { AuthLimitResult } from "./auth-rate-limit-response";

const unavailable = (): AuthLimitResult => ({ allowed: false, status: 503, retryAfter: 60 });
const policies = {
  loginIp: { requests: 30, window: "10 m" },
  loginEmail: { requests: 10, window: "15 m" },
  registrationIp: { requests: 5, window: "1 h" },
} as const;

// Cache SDK clients only. All counters live in Redis, shared across instances.
let state: { secret: string; limiters: Record<keyof typeof policies, Ratelimit> } | undefined;

function getState() {
  if (state) return state;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const secret = process.env.RATE_LIMIT_KEY_SECRET;
  if (!url || !token?.trim() || !secret || secret.trim().length < 32) throw new Error("Limiter configuration unavailable");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Invalid limiter endpoint");
  const environment = process.env.VERCEL === "1" ? process.env.VERCEL_ENV : "local";
  if (!environment || !(process.env.VERCEL === "1" ? ["production", "preview", "development"] : ["local"]).includes(environment)) throw new Error("Invalid limiter environment");
  const redis = new Redis({
    url, token, retry: { retries: 0 }, signal: () => AbortSignal.timeout(1000),
    enableTelemetry: false, enableAutoPipelining: false,
  });
  const build = (scope: keyof typeof policies) => new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(policies[scope].requests, policies[scope].window),
    prefix: `reservehub:auth:${environment}:${scope}`,
    ephemeralCache: false,
    analytics: false,
    enableProtection: false,
    timeout: 1000,
  });
  state = { secret, limiters: { loginIp: build("loginIp"), loginEmail: build("loginEmail"), registrationIp: build("registrationIp") } };
  return state;
}

export function trustedClientIp(request: Request): string | null {
  // Vercel overwrites this header at its ingress. Never accept it from a
  // standalone server, or fall back to caller-controlled forwarding chains.
  if (process.env.VERCEL !== "1") {
    const hostname = new URL(request.url).hostname;
    return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? "127.0.0.1" : null;
  }
  const value = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (!value || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  try {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return canonical;
  } catch { return null; }
}

function identifier(secret: string, kind: "ip" | "email", value: string) {
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

async function consume(limiter: Ratelimit, key: string): Promise<AuthLimitResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = (async () => {
      const result = await limiter.limit(key);
      await result.pending;
      return result;
    })();
    const result = await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Limiter deadline")), 1500); }),
    ]);
    // The SDK explicitly returns success:true on timeout. That is not permission
    // to authenticate. Unexpected/malformed results also fail closed.
    if (result.reason !== undefined || typeof result.success !== "boolean" ||
      !Number.isSafeInteger(result.reset) || result.reset <= 0 ||
      !Number.isSafeInteger(result.limit) || result.limit <= 0 ||
      !Number.isSafeInteger(result.remaining) || result.remaining < 0 || result.remaining > result.limit ||
      (!result.success && result.remaining !== 0)) return unavailable();
    if (result.success) return { allowed: true };
    return { allowed: false, status: 429, retryAfter: Math.min(3600, Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))) };
  } catch {
    // Never propagate SDK errors: they can contain connection or token details.
    return unavailable();
  } finally { if (timer) clearTimeout(timer); }
}

export async function checkLoginLimit(request: Request, email: unknown): Promise<AuthLimitResult> {
  try {
    const ip = trustedClientIp(request);
    if (!ip) return unavailable();
    const { secret, limiters } = getState();
    const ipLimit = await consume(limiters.loginIp, identifier(secret, "ip", ip));
    if (!ipLimit.allowed) return ipLimit;
    // Count before credential validation/lookup, including nonexistent accounts.
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    return consume(limiters.loginEmail, identifier(secret, "email", normalized));
  } catch { return unavailable(); }
}

export async function checkRegistrationLimit(request: Request): Promise<AuthLimitResult> {
  try {
    const ip = trustedClientIp(request);
    if (!ip) return unavailable();
    const { secret, limiters } = getState();
    return consume(limiters.registrationIp, identifier(secret, "ip", ip));
  } catch { return unavailable(); }
}
