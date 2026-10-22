import { AsyncLocalStorage } from "node:async_hooks";

export type AuthLimitResult =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; retryAfter: number };

type Denied = Extract<AuthLimitResult, { allowed: false }>;
const authAttempt = new AsyncLocalStorage<{ denied?: Denied }>();

export function recordAuthLimitFailure(result: Denied) {
  const attempt = authAttempt.getStore();
  if (attempt) attempt.denied = result;
}

export function withAuthRateLimitResponse(request: Request, handler: () => Promise<Response>) {
  return authAttempt.run({}, async () => {
    const response = await handler();
    return authRateLimitResponse(request, response, authAttempt.getStore()?.denied);
  });
}

// Only a status and bounded delay cross Auth.js's public error-URL boundary.
export function authLimitCode(result: Extract<AuthLimitResult, { allowed: false }>): string {
  return `${result.status === 429 ? "rate_limited" : "rate_unavailable"}_${result.retryAfter}`;
}

export function parseAuthLimitCode(code: string | null) {
  const match = /^(rate_limited|rate_unavailable)_([1-9]\d{0,3})$/.exec(code ?? "");
  if (!match || Number(match[2]) > 3600) return null;
  return { status: match[1] === "rate_limited" ? 429 : 503, retryAfter: Number(match[2]) };
}

// next-auth 5.0.0-beta.32's React client parses data.url even on HTTP errors.
// Native forms retain a redirect; signIn() clients receive 429/503 plus { url }.
export async function authRateLimitResponse(request: Request, response: Response, denied?: Denied): Promise<Response> {
  // Error URLs are user-controllable callback destinations too. Only a denial
  // recorded by the provider in THIS async request may change the HTTP status.
  if (!denied) return response;
  if (new URL(request.url).pathname.replace(/\/$/, "") !== "/api/auth/callback/credentials") return response;
  const jsonRedirect = request.headers.has("X-Auth-Return-Redirect");
  let location = response.headers.get("Location");
  if (jsonRedirect) {
    const body = await response.clone().json().catch(() => null);
    location = typeof body?.url === "string" ? body.url : null;
  }
  if (!location) return response;
  let url: URL;
  try { url = new URL(location, request.url); } catch { return response; }
  if (url.pathname !== "/login" || url.searchParams.get("error") !== "CredentialsSignin") return response;
  const limit = parseAuthLimitCode(url.searchParams.get("code"));
  if (!limit || limit.status !== denied.status || limit.retryAfter !== denied.retryAfter) return response;
  const headers = new Headers(response.headers);
  headers.set("Retry-After", String(limit.retryAfter));
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: jsonRedirect ? limit.status : response.status, headers });
}
