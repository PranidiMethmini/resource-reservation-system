# ReserveHub — Resource Reservation Management System

ReserveHub manages shared rooms and equipment, helping organizations track bookings and prevent overlapping confirmed reservations. It was developed for the PrimeWave Lab Software Engineering Internship assessment.

## Key features

- Registration, credentials sign-in, and session-based sign-out.
- USER and ADMIN access enforced on the server.
- Resource browsing, searching by name/type/location, and type/status filtering.
- ADMIN resource creation, editing, activation, and deactivation.
- Booking with a live summary, future-time validation, and conflict feedback.
- Personal reservations with search, filters, sorting, and eligible cancellation.
- Read-only ADMIN reservation overview across all users.
- Database-level double-booking protection and coordinated booking/deactivation.
- Personalized dashboard with real resource and reservation statistics.

## Technology stack

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, PostgreSQL, Prisma 7 with PrismaPg, and NextAuth v5 (Auth.js beta). bcryptjs hashes passwords, Zod validates data, and pg/dotenv support database utilities.

## Prerequisites

- Node.js 22.12 or newer within the Node.js 22 release line; development verification used 22.16.0.
- npm and Git.
- Local PostgreSQL; development uses PostgreSQL 18.
- Database permissions to apply migrations and install `btree_gist`, or an administrator who can provision the extension.
- Upstash Redis configuration for registration and new sign-ins; automated tests mock Redis and need no service credentials.
- Internet access during installation and initial builds: `next/font/google` downloads Geist fonts during compilation.

## Getting started

Run commands from the repository root. Replace the clone placeholders with the published URL and cloned directory name.

```bash
git clone <REPOSITORY_URL>
cd <CLONED_DIRECTORY>
npm ci
```

Copy `.env.example` to `.env` and replace every placeholder. PowerShell:

```powershell
Copy-Item .env.example .env
```

Create an empty local database using PostgreSQL tooling:

```bash
createdb -h localhost -U postgres reservehub_db
```

Use your own local database account if different. Authenticate through the password prompt when required; do not place a real password in command arguments.

Apply committed migrations and generate Prisma Client:

```bash
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

The nonstandard configuration filename requires `--config`. The migrations create the tables and overlap constraint. For an existing database, back up data and check confirmed overlaps before applying pending migrations; do not reset data to resolve migration errors.

Optionally insert demo resources:

```bash
node prisma/seed-resources.mjs
```

The seed inserts up to 12 rooms/equipment items. It skips existing names after trimming and case normalization, preserves existing resources/users/reservations, and serializes check/insert operations in a transaction. It accepts only a loopback connection to `reservehub_db`, rejects production mode and conflicting `.env.local` database URLs, and does not create users.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), register at `/register`, then sign in at `/login`.

## Environment variables

Configure these server-only variables privately in local environment files or the matching Vercel environment. Never commit their values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL used by PrismaPg, the Prisma CLI, and resource seed. URL-encode special characters in credentials. |
| `AUTH_SECRET` | Strong random secret used by Auth.js to protect sessions. |
| `UPSTASH_REDIS_REST_URL` | HTTPS REST endpoint for the authentication limiter's Upstash Redis database. |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST access token. |
| `RATE_LIMIT_KEY_SECRET` | Independent cryptographically random HMAC key, at least 32 characters; do not reuse the session secret. |

Generate a fresh secret locally and paste it into your private `.env`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

This intentionally displays the newly generated secret in your own terminal. Do not share or commit it, or use the example placeholder as a real secret.

Next.js also reads `.env.local`, which can override `.env`. The Prisma configuration imports `dotenv/config`, and the seed explicitly reads `.env`. Keep setup values in `.env` and avoid conflicting overrides. No public client-side environment variables are required. Real environment files remain ignored; `.env.example` contains placeholders only.

## Authentication rate limiting

The Upstash SDKs use shared Redis counters and atomic server-side operations with weighted sliding windows. SDK clients are reused within each process; no in-memory counters authorize production requests. Starting limits count attempts before identity lookup, credential validation, or password hashing:

| Scope | Limit |
| --- | --- |
| Credentials login per IP | 30 attempts per 10 minutes |
| Credentials login per normalized email, across IPs | 10 attempts per 15 minutes |
| Registration per IP | 5 attempts per hour |

Create an Upstash Redis database through its dashboard when configuring the deployment, and set the three rate-limiter variables privately. This repository does not provision services. Without complete configuration, new login and registration attempts return a controlled unavailable response, including in local development. Existing sessions, session reads, and sign-out do not depend on Redis. Builds and automated tests require no Redis credentials or connection.

On Vercel, client identity uses only the platform-managed `x-vercel-forwarded-for` metadata, gated on the platform environment marker. Invalid or missing metadata fails closed; arbitrary `x-forwarded-for` and `x-real-ip` values are ignored. Deploy directly behind Vercel ingress; adding another proxy requires a separate trust review. Standalone production servers are deliberately unsupported for new authentication attempts. Non-production loopback development uses one fixed loopback bucket, still backed by Redis, and never trusts incoming IP headers.

Email addresses are trimmed/lowercased. Equivalent IP representations are canonicalized. Only HMAC identifiers enter Redis keys; raw emails, IPs, passwords, tokens, and provider error details are not logged by the limiter. Counters expire automatically; analytics, SDK telemetry, and local decision caching are disabled. Stable prefixes separate Vercel production, preview, and local environments. HMAC key rotation resets the identifier namespace, so coordinate rotations across instances.

Redis transport has no automatic retries and a one-second request deadline; each limiter decision has a 1.5-second outer deadline. SDK timeout results, errors, quota failures, malformed results, and pending-operation failures all deny new authentication with 503 and a 60-second retry hint. Quota exhaustion can therefore interrupt new sign-ins: monitor provider usage before public exposure. Exceeded limits return 429 with a bounded `Retry-After` hint. Login preserves NextAuth 5.0.0-beta.32's JSON redirect envelope; native form requests retain Auth.js redirects and receive the retry header. Clients show a generic wait/unavailable message and do not automatically resubmit credentials. Authentication failures use generic responses. Valid new and duplicate registrations both return the same 201 message without a user payload; duplicate inserts never overwrite existing credentials or roles. Every valid registration submission performs cost-12 hashing, and missing-user login performs a cost-12 dummy comparison, reducing account-existence timing signals. Auth.js raw exception and cause logging is disabled.

`GET /api/resources` requires a session belonging to a current database user and returns private, non-cacheable responses. Signed-in browsing continues to include both active and inactive resources.

For offline development, run the mocked test suite; it exercises authentication without Redis or database credentials. For manual browser testing, use `npm run dev` with a separately approved non-production Redis database and independent private credentials/HMAC key. Standalone development always uses the local namespace, regardless of a stray Vercel environment label. Do not set the Vercel platform marker locally or forge platform IP headers. All local browsers share the loopback IP quota; wait for expiry or reset only dedicated development counters through the provider console. `npm run start` is production mode and deliberately rejects new sign-ins outside trusted Vercel ingress. A deployed Vercel instance must expose its production/preview/development environment metadata; missing metadata fails closed. No production bypass is provided.

## User roles and demo setup

| Role | Permissions |
| --- | --- |
| USER | Browse resources, book, view personal reservations, and cancel eligible bookings. |
| ADMIN | Personal booking features, resource management, and read-only oversight of all users' reservations. |

Registration always creates a USER. Passwords use bcrypt cost factor 12. Registration requires at least 8 characters and limits passwords to 72 UTF-8 bytes. No demo credentials are bundled.

Provision an ADMIN from an interactive local terminal after migrations:

```bash
npm run admin:setup
```

Choose `create` for a new account or `promote` for an existing registered USER. Enter the email and type the requested `ADMIN <normalized-email>` confirmation. Creation asks for a name and hidden password/confirmation, using the same registration validation and bcrypt cost 12. Promotion changes only the role, preserving the password and other fields. Existing ADMIN accounts are never overwritten. Sign out and sign in again afterwards.

The command requires an interactive terminal, accepts no arguments, and permits only verified local `reservehub_db` outside production with consistent environment files. Never pass passwords through shell arguments or chat. It uses parameterized PostgreSQL queries and a transaction; it does not require a generated Prisma Client at runtime. Node 22 uses the experimental built-in TypeScript stripping flag to import the application's shared validation rules; an experimental warning is expected.

Test different accounts in separate browser profiles or normal/Incognito windows. Tabs in the same profile share authentication cookies.

## Database design

- **User:** UUID identifier, name, unique email, password hash, role, timestamps.
- **Resource:** UUID identifier, name, optional description, type, location, capacity, activation flag, timestamps. Positive capacity is application-validated; names are not database-unique.
- **Reservation:** UUID identifier, user/resource foreign keys, start/end times, status, timestamps. Indexes support owner and resource/time queries; foreign keys restrict deletion of referenced records.

Users and resources each have many reservations. Persisted statuses are `CONFIRMED` and `CANCELLED`. Upcoming, ongoing, and completed labels derive from time rather than extra database statuses. Deactivation prevents new bookings without cancelling existing reservations.

## Architecture and engineering decisions

**Authorization:** Auth.js uses Credentials and JWT sessions. Dashboard layouts require authentication. ADMIN pages and resource mutation APIs check the current database role independently of hidden navigation controls. Personal reservation APIs derive ownership from the session and scope queries/cancellation to that owner. The ADMIN reservation API returns 401 for missing authentication and 403 for non-ADMIN users.

**Dates and times:** Booking inputs represent Asia/Colombo time and are parsed with an explicit `+05:30` offset, then submitted as instants. Display helpers use `Asia/Colombo` regardless of browser timezone. Existing columns are `TIMESTAMP(3) WITHOUT TIME ZONE`; the application preserves its Prisma/JavaScript timestamp convention. The form requires a future start and later end on the same date. Only future confirmed reservations can be cancelled; cancellation preserves the record.

**Double-booking:** The migration installs `btree_gist` and a GiST exclusion constraint combining resource equality with `tsrange(startTime, endTime, '[)')` overlap for confirmed reservations. Adjacent bookings are allowed, different resources do not conflict, and cancelled records are excluded. Application overlap checks and PostgreSQL exclusion violations return friendly HTTP 409 responses.

**Booking/deactivation race protection:** Booking and resource updates/deactivation acquire the same resource row with parameterized `SELECT ... FOR UPDATE` inside short Prisma transactions at Read Committed isolation. Booking rechecks activation and future start after acquiring the lock, then checks overlap and inserts before releasing it. Deactivation cannot commit between that final check and insertion. Lock/statement timeouts bound waits; busy transactions return retryable HTTP 503 responses. Authentication occurs before acquiring the resource lock.

**Rendering:** Server components query Prisma directly where appropriate. Client components handle interactive forms, search/filtering, reservation controls, and the profile menu. Personal and ADMIN-wide reservation endpoints remain separate.

## Testing and verification

```bash
npx tsc --noEmit --incremental false
npm run lint
node --experimental-strip-types --test tests/admin-setup.test.mjs tests/admin-reservations.test.mjs tests/admin-resources.test.mjs tests/auth-rate-limit.test.mjs tests/booking.test.mjs tests/reservation-conflicts.test.mjs tests/reservations.test.mjs tests/resource-catalog.test.mjs tests/resource-coordination.test.mjs tests/validation-audit.test.mjs
npm run build
```

There is no `npm test` script. The explicit command selects ten test files and excludes the support fixture. Tests cover authentication limits and failure handling, the installed Auth.js client, validation, filters/sorting, timezone helpers, authorization/ownership, conflict handling, seed repeatability, and simulated booking/deactivation interleavings. Redis and database interactions are mocked; tests do not prove live provider behavior or real PostgreSQL concurrency, and do not replace deployed browser testing.

After a successful build, run local production mode:

```bash
npm run start
```

Stop any development server using port 3000 first. Compilation is separate from browser and deployment verification.

## Project structure

```text
prisma/
  schema.prisma          Entities and enums
  migrations/            Initial schema and overlap constraint
  seed-resources.mjs     Explicit local resource seed
scripts/setup-admin.mjs   Interactive local ADMIN provisioning
prisma7.config.ts        Prisma CLI configuration
src/
  auth.ts                Credentials authentication
  app/
    (dashboard)/         Protected dashboard/catalog/booking/reservations
      admin/             Overview, resource forms, reservation overview
    api/                 Auth, registration, resources, reservations
    login/               Sign In
    register/            Create Account
  components/            Shared UI and interactive components
  lib/                   Prisma, validation, time, filtering, locking helpers
  generated/prisma/      Generated client (ignored; generate during setup)
tests/                   Node test suites and support fixture
public/                  Local static assets
```

## Known limitations

- ADMIN provisioning is intentionally local-only; no public role-management endpoint is provided.
- ADMIN reservation management is read-only.
- Active resources are bookable, not guaranteed free at a particular time; conflicts are checked on submission.
- Catalog/reservation lists use client-side filtering without pagination.
- Password reset, email verification, and social sign-in are not implemented.
- Automated concurrency coverage uses simulations rather than a real PostgreSQL concurrency harness.
