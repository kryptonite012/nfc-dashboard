# Architecture

## Overview

```
Browser ──HTTPS──▶  VaultLedger API (Express)  ──▶  PostgreSQL
  React SPA          /api/*  REST + JSON              Prisma ORM
  (same origin)      /*      built SPA (optional)     migrations
                         │
                         ├──▶ SMTP server (email)
                         └──▶ Twilio REST API (SMS, optional)
```

The web app and the API are served from **one origin** in the recommended deployment (the API serves
`apps/web/dist` when `WEB_DIST_DIR` is set). In development, Vite proxies `/api` to the API, so the browser
also sees a single origin. A single origin keeps the session cookie first-party, lets us use `SameSite=Lax` and
`__Host-` cookies, and removes the need for CORS.

## Monorepo

npm workspaces:

- `packages/shared` — Zod schemas, money utilities and API response types. The web app uses the schemas for
  client-side validation and the API uses the same schemas for authoritative server-side validation.
- `apps/api` — Express 5 API. Bundled with tsup for production (the shared package is bundled in).
- `apps/web` — React SPA built with Vite.

## API structure (`apps/api/src`)

| Path | Responsibility |
| --- | --- |
| `config.ts` | Loads and validates environment variables; refuses unsafe production settings |
| `app.ts` | Middleware order: request id → logging → security headers → CORS (opt-in) → JSON body → cookies → rate limit → CSRF → session → routers → error handler |
| `middleware/` | `auth` (session loading, `requireAuth`, `requireRecentAuth`), `csrf`, `rate-limit`, `errors` |
| `routes/` | `auth`, `account`, `items`, `categories`, `insights` (overview, analytics, activity, notifications), `data` (import/export), `system` (health, readiness, public config) |
| `services/` | Business logic: sessions, verification tokens, items, analytics, import, export, activity/notifications, mailer, SMS, delivery |
| `lib/` | Crypto helpers, password hashing and strength, phone normalisation, serialisation, time zones, CSV, HTTP helpers |

### Request/response format

Successful responses: `{ "data": …, "meta"?: … }`. Errors: `{ "error": { "code", "message", "fields"?, "requestId" } }`
with a stable `code` (e.g. `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `VERSION_CONFLICT`). Field-level
validation messages are keyed by field path so forms can show them inline. Unexpected errors return a generic
message plus a request id that appears in the server logs.

## Data model

```
users ─┬─< sessions
       ├─< verification_tokens        (email verify, email change, password reset, phone OTP)
       ├─< categories ─┐
       ├─< items >─────┘ (category optional, ON DELETE SET NULL)
       │     ├─< price_history         snapshot on create and on every price/currency/quantity change
       │     └─< value_ledger          signed change in collection value (ADD / REMOVE / REPRICE)
       ├─< activity_log
       └─< notifications
```

All user-owned tables carry `user_id` with `ON DELETE CASCADE`, so deleting an account removes everything.
Every query filters by the authenticated user's id; record ids are random UUIDs.

### Money

Prices are stored as **integer minor units** (`BIGINT`, e.g. paise or cents) plus an ISO 4217 code. The number
of decimals per currency (0 for JPY, 3 for KWD, 2 for most) comes from `packages/shared/src/currencies.ts`.
Parsing and formatting are done on strings and `BigInt` — no floating-point arithmetic is ever applied to
money. Sums use PostgreSQL `NUMERIC`, so totals cannot overflow. The API returns amounts as exact decimal
strings; the browser formats them with `Intl.NumberFormat`, which formats decimal strings exactly.

Amounts in different currencies are never added together; the dashboard reports per currency and leads with
the user's default currency.

### "Total recorded value" and history

- **Total recorded value** = Σ(unit price × quantity) over active (not deleted) records, per currency.
- **Average item price** = mean unit price of active records, rounded half away from zero to the minor unit.
- **Collection value over time** is reconstructed from the append-only `value_ledger`: each create, restore,
  delete, re-price and currency change appends a signed delta. The running sum at the end of a period is the
  collection value at that moment, so the chart reflects real history, including deleted records.
- **Price history** (`price_history`) records each item's own unit price over time. The analytics page shows
  these separately from collection-value changes, so a re-price is never confused with adding an item.

### Concurrency and duplicates

- **Idempotent creates:** the client sends an `Idempotency-Key` per submission. The key is stored with the item
  under a unique constraint, so a retried or double-submitted request returns the original item.
- **Optimistic locking:** every item has a `version`. Updates must send the version they edited; a mismatch
  returns `409 VERSION_CONFLICT` instead of silently overwriting a change made on another device.
- Multi-row changes (create + history + ledger + activity, bulk actions, imports) run in transactions.

## Web app structure (`apps/web/src`)

| Path | Responsibility |
| --- | --- |
| `lib/api.ts` | Fetch wrapper: credentials, CSRF token (memory only), retry on stale CSRF token, typed errors, file downloads |
| `hooks/queries.ts` | TanStack Query hooks and cache invalidation |
| `components/ui` | Accessible primitives (Radix-based) |
| `components/layout` | App shell: sidebar, top bar, breadcrumbs, search, notifications, theme, account menu |
| `components/items`, `components/charts` | Item form, quick add, category dialog, chart components |
| `pages/` | Route pages (auth, app, legal) |

Filters, sorting and pagination on the records page live in the URL, so they survive navigation, refreshes
and the back button. Authentication state comes from `GET /api/auth/session`; nothing sensitive is stored in
`localStorage` (only theme and sidebar preferences).

## Background work

- Email and SMS are sent in the background so response time does not reveal whether an account exists.
- An hourly job deletes expired sessions and used/expired verification tokens.
