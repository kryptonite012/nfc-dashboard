# Configuration

The API reads its configuration from environment variables (and, in development only, from `apps/api/.env`).
Everything is validated at startup; invalid or unsafe values stop the server with a message naming the
variable (values are never printed). `apps/api/.env.example` lists every variable.

## Core

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables strict checks (see below) |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | |
| `DATABASE_URL` | — (required) | PostgreSQL connection string. Use `?sslmode=require` with managed databases |
| `APP_URL` | `http://localhost:5173` | Public URL of the web app. Used in email links and as the allowed request origin |
| `EXTRA_ALLOWED_ORIGINS` | empty | Comma-separated extra origins (only for split frontend/API hosting) |
| `TOKEN_PEPPER` | — (required, ≥ 32 chars) | Secret key for hashing one-time codes. `openssl rand -base64 48` |
| `COOKIE_SECURE` | `true` in production | Must be `true` in production. When true, cookies use the `__Host-` prefix |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the API (1 on most PaaS hosts) |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `WEB_DIST_DIR` | unset | Path to `apps/web/dist`; when set the API also serves the web app |
| `APP_NAME` | `VaultLedger` | Used in emails |

## Sessions

| Variable | Default | Meaning |
| --- | --- | --- |
| `SESSION_IDLE_MINUTES` | 120 | Sign out after this much inactivity (normal sessions) |
| `SESSION_ABSOLUTE_HOURS` | 12 | Maximum lifetime of a normal session |
| `REMEMBER_ME_DAYS` | 30 | Lifetime of a "keep me signed in" session |
| `SESSION_ROTATION_MINUTES` | 15 | Session token rotation interval |
| `REAUTH_WINDOW_MINUTES` | 10 | How long a password confirmation unlocks sensitive actions |

## Email

| Variable | Notes |
| --- | --- |
| `EMAIL_TRANSPORT` | `smtp` (real delivery; default in production) or `outbox` (development only: writes messages to `MAIL_OUTBOX_DIR`) |
| `EMAIL_FROM` | e.g. `VaultLedger <no-reply@yourdomain.com>` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Any SMTP provider (Amazon SES, Postmark, SendGrid, Mailgun, Resend, Microsoft 365…). Port 587 with STARTTLS (`SMTP_SECURE=false`) or 465 with TLS (`SMTP_SECURE=true`). In production, STARTTLS is required on non-TLS ports. |

The API verifies the SMTP connection at startup and logs an error (without stopping) if it fails.
Set up SPF, DKIM and DMARC for the sending domain, or verification emails will land in spam.

## SMS (optional)

| Variable | Notes |
| --- | --- |
| `SMS_PROVIDER` | `disabled` (default: phone fields hidden, phone sign-in off), `twilio`, or `outbox` (development only) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | From the Twilio console |
| `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` | Sender number (E.164) or Messaging Service |
| `REQUIRE_PHONE_ON_SIGNUP` | `false` by default; requires an SMS provider |
| `DEFAULT_PHONE_REGION` | `IN`; region assumed for numbers typed without a country code |

VaultLedger generates, hashes and checks one-time codes itself and only uses Twilio to deliver the text, so
the code-security guarantees (expiry, attempt limits, single use) do not depend on the provider. Enable Twilio's
geo-permissions and fraud guard to limit SMS pumping abuse.

## Other

| Variable | Notes |
| --- | --- |
| `HIBP_ENABLED` | `true` to reject passwords found in the Have I Been Pwned corpus (k-anonymity; only 5 hex chars of a SHA-1 leave the server; fails open if the service is unreachable) |
| `RATE_LIMIT_ENABLED` | `true` by default; may only be disabled outside production (used by automated tests) |
| `PDF_FONT_PATH` | TrueType font used for PDF exports. Defaults to DejaVu Sans if installed (the Docker image installs it). Without one, non-Latin characters are replaced in PDFs |
| `MAIL_OUTBOX_DIR`, `SMS_OUTBOX_DIR` | Development outbox locations |

## Production safety checks

With `NODE_ENV=production` the server refuses to start if:

- `EMAIL_TRANSPORT=outbox` or `SMS_PROVIDER=outbox`
- `COOKIE_SECURE` is not `true`
- `APP_URL` is not `https://` (except `http://localhost` for a local production preview)
- rate limiting is disabled
- SMTP or Twilio is selected without its required settings

## Web app

The web app needs no runtime configuration when it is served from the same origin as the API. For split
hosting only, build it with `VITE_API_URL=https://api.example.com` (see DEPLOYMENT.md).
