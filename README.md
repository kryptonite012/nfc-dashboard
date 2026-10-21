hi

# VaultLedger — Secure Item & Price Manager

VaultLedger is a full-stack web application for recording items and their prices, privately, per account.
Signed-in users can add, search, filter, edit and delete records, see exact totals and charts, export to CSV
or PDF, import from CSV, and manage their account security from any device.

It has a real backend: an Express + TypeScript REST API, a PostgreSQL database managed with Prisma
migrations, server-side session authentication with Argon2id password hashing, and automated tests at three
levels (unit, API integration against PostgreSQL, and end-to-end in a browser).

---

## Features

| Area | What you get |
| --- | --- |
| **Accounts** | Registration with email verification, sign-in by email (or by verified phone when SMS is configured), "remember me", password reset by email link or SMS code, email change with confirmation, phone verification by one-time code, active-session list with remote sign-out, account deletion |
| **Records** | Name, unit price, currency (default INR, 33 supported), quantity, category, SKU, description, supplier, purchase date, tags. Create via full form or quick-add modal, "save and add another", idempotent saves, optimistic-concurrency edits |
| **Records table** | Server-side search (name, SKU, description, supplier, tag), sorting, filters (category, currency, price range, date range, tag), pagination, bulk move-to-trash / restore / permanent delete / set category, trash with undo, CSV/PDF export of the filtered view, mobile card layout |
| **Dashboard** | Total records, total recorded value, average price and highest-priced item (per currency, never mixed), recently added/updated, value over time, items added per period, category distribution, top items |
| **Analytics** | Collection value reconstructed from an append-only value ledger, a breakdown of what changed it (additions, removals, re-pricing), price distribution, recent price changes, day/week/month grouping, custom ranges, table view for every chart |
| **Data** | CSV import with preview and per-row validation, CSV and PDF export, full JSON account export |
| **Activity & notifications** | Per-user activity history (records, security, data) and in-app notifications for security events and imports |
| **Experience** | Collapsible sidebar, breadcrumbs, global search (Ctrl K), light/dark/system theme saved to the account, skeletons, empty and error states, toasts, confirmation dialogs, keyboard and screen-reader support, responsive from phone to desktop |

## Technology

- **Web:** React 19, TypeScript, Vite, Tailwind CSS, Radix UI primitives (shadcn-style components), Lucide, Recharts, React Hook Form + Zod, TanStack Query, React Router
- **API:** Node.js 22, Express 5, TypeScript, Zod, Pino structured logging, Helmet, express-rate-limit, Nodemailer, PDFKit
- **Database:** PostgreSQL 16 with Prisma ORM and migrations
- **Auth:** First-party server-side sessions (opaque tokens in `HttpOnly; Secure; SameSite` cookies), Argon2id, CSRF protection, optional SMS via Twilio
- **Quality:** Vitest, Supertest, Testing Library, Playwright, ESLint, GitHub Actions CI, Docker

## Repository layout

```
apps/
  api/            Express REST API, Prisma schema & migrations, integration tests
  web/            React single-page app
packages/
  shared/         Zod schemas, money utilities and API types used by both apps
e2e/              Playwright end-to-end tests
docs/             Architecture, security, configuration, deployment, backups, API reference
```

## Quick start (local development)

Requirements: Node.js 22 (see `.nvmrc`) and PostgreSQL 16 (local install or Docker).

```bash
# 1. Start PostgreSQL and a local mail catcher (or use your own PostgreSQL)
docker compose up -d db mailpit

# 2. Install dependencies (also generates the Prisma client)
npm install

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
#    then set TOKEN_PEPPER to a long random value, e.g.  openssl rand -base64 48

# 4. Create the database schema
npm run db:migrate

# 5. Run the API (http://localhost:4000) and the web app (http://localhost:5173)
npm run dev
```

Open http://localhost:5173 and create an account.

**Where do verification emails go in development?** By default `EMAIL_TRANSPORT=outbox`, so emails are *not
sent*; they are written to `apps/api/.mail-outbox/` and the server logs a warning saying so. To see them in a
real inbox UI instead, point SMTP at Mailpit (`EMAIL_TRANSPORT=smtp`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`)
and open http://localhost:8025. Production refuses to start with the outbox transport.

**Phone sign-in and SMS codes** are disabled until you configure an SMS provider (`SMS_PROVIDER=twilio`).
For local testing, `SMS_PROVIDER=outbox` writes codes to `apps/api/.sms-outbox/` (development only).

**Optional demo data:**

```bash
SEED_DEMO_PASSWORD='choose-a-strong-passphrase' npm run db:seed
# signs in as demo@vaultledger.local with the password you chose
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (watch mode) and web dev server |
| `npm run build` | Production build of web (`apps/web/dist`) and API (`apps/api/dist`) |
| `npm start` | Run the built API (set `WEB_DIST_DIR` to also serve the web app) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript across all workspaces |
| `npm test` | Unit tests (shared, web) and API integration tests (needs PostgreSQL, see below) |
| `npm run test:e2e` | Playwright browser tests (starts its own API and web server) |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:deploy` | Apply committed migrations (production) |
| `npm run db:seed` | Development demo data (refuses to run in production) |

### Tests

- **Integration tests** run the real API against a PostgreSQL database whose name must contain `test`
  (default `postgresql://vaultledger:vaultledger_dev@localhost:5432/vaultledger_test`; override with
  `TEST_DATABASE_URL`). Create it once with `createdb vaultledger_test`. Tests truncate its tables.
- **End-to-end tests** use a separate database (`vaultledger_e2e`, override with `E2E_DATABASE_URL`) and ports
  4100/5174. Install a browser once with `npx playwright install chromium`.

## Deployment

The recommended deployment is a **single container** that serves both the API and the built web app from one
HTTPS origin, plus a **managed PostgreSQL** database:

```bash
docker build -t vaultledger .
docker run -p 4000:4000 --env-file production.env vaultledger
```

`docker compose --profile app up --build` runs a production-mode preview locally at http://localhost:8080.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for step-by-step guides (Render / Railway / Fly.io with Neon,
Supabase or Amazon RDS, and split hosting on Vercel or Netlify) and the go-live checklist.

## Hosted edition on claude.ai

The same web app can also be published as a claude.ai artifact, with no server or database to run:

- **Sign-in** is the viewer's Claude account (claude.ai handles passwords and two-step verification).
- **Storage** is claude.ai's artifact database. Each person's records live in their own private space that
  nobody else can read, including the artifact's owner.
- An in-browser module (`apps/web/src/lib/local/`) answers the app's API routes with the same validation,
  error codes and calculations as the Express server, so every page works unchanged.
- Differences from the self-hosted edition: no PDF export, CSV import is limited to 1,000 rows per file, and
  there is no in-app sign-out (sign out of claude.ai instead). People you share the link with need
  **Contributor** access to save their own records.

Build it with `npm run build:claude --workspace @vaultledger/web`, then publish
`apps/web/dist-claude/vaultledger.html` together with the `assets/` folder next to it, declaring the `db`,
`user` (scope `profile`) and `downloads` capabilities.

## Configuration and integrations

All secrets and settings come from environment variables, validated at startup. The server refuses to start in
production with unsafe settings (development email/SMS outboxes, insecure cookies, plain-HTTP `APP_URL`,
disabled rate limiting). See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

| Integration | Status out of the box | To activate |
| --- | --- | --- |
| PostgreSQL | Required | `DATABASE_URL` |
| Email (verification, resets, notices) | Development outbox only | `EMAIL_TRANSPORT=smtp` + `SMTP_*` + `EMAIL_FROM` |
| SMS (phone verification, phone sign-in, SMS reset) | Disabled | `SMS_PROVIDER=twilio` + `TWILIO_*` |
| Breached-password check (Have I Been Pwned) | Off | `HIBP_ENABLED=true` |
| HTTPS | Provided by your host or reverse proxy | `APP_URL=https://…`, `COOKIE_SECURE=true`, `TRUST_PROXY` |

## Security

Highlights: Argon2id hashing, rejection of guessable passwords, enumeration-safe sign-up/sign-in/reset
responses, per-IP and per-identifier rate limits plus account lockout, single-use hashed tokens and HMAC'd
one-time codes with expiry and attempt limits, session rotation and fixation protection, re-authentication for
sensitive actions, CSRF protection, strict Content Security Policy, owner-scoped queries everywhere,
redacted logs. Details, threat model and the pre-launch checklist are in [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Configuration](docs/CONFIGURATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Backups and restoration](docs/BACKUP_RESTORE.md)
- [API reference](docs/API.md)

## Known limitations

- **Attachments** are not implemented. Accepting files safely needs object storage, size/type validation and
  malware scanning; the form says so rather than offering an unsafe upload.
- **Rate limits** use in-memory counters, which are correct for one API instance. Running several instances
  requires a shared store (see the deployment guide).
- **Currencies are never converted.** Totals are reported per currency; mixing them would need exchange rates.
- **Legal pages** (`/privacy`, `/terms`) are templates that must be reviewed before launch.
