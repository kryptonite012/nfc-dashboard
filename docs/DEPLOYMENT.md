# Deployment

## Recommended topology

```
   https://vault.example.com
            │  (TLS terminated by the platform or a reverse proxy)
            ▼
  ┌──────────────────────────┐        ┌─────────────────────────┐
  │ VaultLedger container    │──TLS──▶│ Managed PostgreSQL 16   │
  │  /api/*  REST API        │        │ (automated backups+PITR)│
  │  /*      built web app   │        └─────────────────────────┘
  └──────────────────────────┘──▶ SMTP provider, (optional) Twilio
```

One container serves the API and the web app from the same origin. This is the simplest and most secure
option: first-party cookies, no CORS, one TLS certificate.

The `Dockerfile` builds the web app and API, installs only production dependencies, runs as the unprivileged
`node` user, includes a health check, and on start applies pending migrations (`prisma migrate deploy`) before
launching the server.

## Step by step: Render, Railway or Fly.io + managed PostgreSQL

1. **Create the database** on Neon, Supabase, Amazon RDS, Render PostgreSQL, Railway PostgreSQL or Fly
   Postgres (PostgreSQL 16). Enable automated backups / point-in-time recovery. Copy the connection string and
   add `?sslmode=require` if the provider requires TLS.
2. **Create a web service from this repository** using the `Dockerfile`. The container listens on port `4000`
   (`PORT` can be changed).
3. **Set environment variables** in the platform's secret settings (never commit them):

   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://…?sslmode=require
   APP_URL=https://vault.example.com
   TOKEN_PEPPER=<openssl rand -base64 48>
   TRUST_PROXY=1
   EMAIL_TRANSPORT=smtp
   EMAIL_FROM=VaultLedger <no-reply@example.com>
   SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=…
   SMS_PROVIDER=disabled            # or twilio + TWILIO_* settings
   HIBP_ENABLED=true                # optional
   ```

4. **Health checks:** liveness `GET /api/health`, readiness `GET /api/ready` (checks the database).
5. **Custom domain and HTTPS:** attach your domain; the platform provisions the certificate. HSTS is sent
   automatically in production.
6. **Smoke test:** register, receive the verification email, sign in, add an item, export a CSV, sign out.

### Plain VM or Kubernetes

Run the same image behind a TLS-terminating reverse proxy (Caddy, nginx, Traefik or a cloud load balancer)
that forwards `X-Forwarded-For`/`X-Forwarded-Proto`, and set `TRUST_PROXY` to the number of proxy hops.
Example with Caddy:

```
vault.example.com {
  reverse_proxy 127.0.0.1:4000
}
```

## Migrations

- Migrations live in `apps/api/prisma/migrations` and are applied with `npm run db:deploy`
  (`prisma migrate deploy`), which only applies committed migrations and never resets data.
- The container applies them on start, which is safe for a single instance. With several instances, run the
  migration as a separate release step (e.g. Render "pre-deploy command", Fly `release_command`, a Kubernetes
  Job) and start the containers with `node apps/api/dist/index.js` directly.
- Create new migrations in development with `npm run db:migrate`, review the SQL, and commit it.
- Take a backup (or confirm point-in-time recovery) before running migrations in production.

## Scaling out

The API is stateless except for **rate-limit counters**, which are in memory. Before running more than one
instance, plug a shared store into `apps/api/src/middleware/rate-limit.ts`, for example
[`rate-limit-redis`](https://www.npmjs.com/package/rate-limit-redis) with a managed Redis, so limits apply across
instances. Sessions are already in PostgreSQL and work across instances. Account lockout is stored in the
database and is unaffected.

## Split hosting (static frontend + separate API)

Supported, but only recommended when the two share a registrable domain, e.g. `app.example.com` (Vercel,
Netlify, Cloudflare Pages) and `api.example.com` (container host). Browsers increasingly block third-party
cookies, so a completely different domain for the API will break sign-in.

1. Build the web app with `VITE_API_URL=https://api.example.com npm run build --workspace @vaultledger/web`
   and deploy `apps/web/dist` with an SPA fallback (all paths → `index.html`). Add the same security headers
   (CSP with `connect-src https://api.example.com`, HSTS, `frame-ancestors 'none'`) in the static host's config.
2. Deploy the API with `APP_URL=https://app.example.com` and `EXTRA_ALLOWED_ORIGINS=https://app.example.com`
   (enables credentialed CORS for that origin only). Leave `WEB_DIST_DIR` unset.

## Local production preview

```bash
TOKEN_PEPPER=$(openssl rand -base64 48) docker compose --profile app up --build
# http://localhost:8080   (emails are caught by Mailpit at http://localhost:8025)
```

## Operations

- **Logs:** JSON on stdout; ship to your platform's log store. Alert on 5xx rate and on spikes of failed sign-ins.
- **Backups:** see [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
- **Updates:** Dependabot opens weekly dependency PRs; CI runs lint, type checks, unit/integration tests,
  end-to-end tests and a Docker build on every pull request.
