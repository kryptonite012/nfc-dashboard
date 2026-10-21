# API reference

Base path: `/api`. All request and response bodies are JSON unless noted.

- Success: `{ "data": … , "meta"?: … }`
- Error: `{ "error": { "code": "VALIDATION_FAILED", "message": "…", "fields"?: { "price": "…" }, "requestId": "…" } }`
- Authentication: the `vl_session` cookie (`__Host-vl_session` over HTTPS) set by `POST /auth/login`.
- **CSRF:** every `POST`, `PATCH` and `DELETE` must send `X-CSRF-Token` with the value from `GET /auth/csrf`
  (which also sets the matching cookie). Browsers must also send an allowed `Origin`.
- Money is exchanged as **decimal strings** (`"1299.50"`), never JSON numbers.
- Rate-limited responses return `429` with `RateLimit-*` headers.

## System

| Method & path | Description |
| --- | --- |
| `GET /health` | Liveness |
| `GET /ready` | Readiness (database reachable) |
| `GET /config` | Public feature flags: `{ appName, features: { phoneAuth, emailDelivery, smsDelivery, pdfExport, breachedPasswordCheck }, requirePhoneOnSignup, passwordMinLength }` |

## Authentication (`/auth`)

| Method & path | Body | Notes |
| --- | --- | --- |
| `GET /auth/csrf` | — | `{ csrfToken }` |
| `GET /auth/session` | — | `{ user: User \| null }` |
| `POST /auth/register` | `{ name, email, phone?, password, confirmPassword, acceptTerms: true }` | Always `202` with a generic message; sends a verification email |
| `POST /auth/verify-email` | `{ token }` | `{ kind: "verified" \| "changed" }` |
| `POST /auth/resend-verification` | `{ email }` | Always `202` |
| `POST /auth/login` | `{ identifier, password, remember? }` | `identifier` is an email, or a verified phone when SMS is enabled. `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED` |
| `POST /auth/logout` | — | Revokes the current session |
| `POST /auth/password/forgot` | `{ identifier }` | Always `202`; email link or SMS code |
| `POST /auth/password/reset` | `{ token, password, confirmPassword }` | Signs out all sessions |
| `POST /auth/password/reset-with-code` | `{ phone, code, password, confirmPassword }` | SMS only |
| `POST /auth/reauth` | `{ password }` | Unlocks sensitive actions for `REAUTH_WINDOW_MINUTES` |

## Account (`/account`, signed in)

| Method & path | Body | Notes |
| --- | --- | --- |
| `GET /account` | — | Current user |
| `PATCH /account/profile` | `{ name }` | |
| `PATCH /account/settings` | `{ defaultCurrency?, theme?, locale?, showQuantity? }` | |
| `POST /account/password` | `{ currentPassword, newPassword, confirmPassword }` | Signs out other sessions, rotates this one |
| `POST /account/email` | `{ newEmail, password }` | Sends a confirmation link to the new address (`202`) |
| `DELETE /account/email/pending` | — | Cancels a pending change |
| `POST /account/phone/start` | `{ phone }` | Sends a 6-digit code (SMS enabled only) |
| `POST /account/phone/verify` | `{ code }` | |
| `DELETE /account/phone` | — | Requires recent re-authentication (`403 REAUTH_REQUIRED`) |
| `GET /account/sessions` | — | Active sessions; `current` marks this device |
| `DELETE /account/sessions/:id` | — | |
| `POST /account/sessions/revoke-others` | — | `{ revoked }` |
| `DELETE /account` | `{ password, confirmation: "DELETE MY ACCOUNT" }` | Permanently deletes the account and all data |

## Items (`/items`, signed in)

| Method & path | Notes |
| --- | --- |
| `GET /items` | Query: `page`, `pageSize` (≤ 100), `q`, `sort` (`name`\|`price`\|`createdAt`\|`updatedAt`), `order`, `categoryId` (uuid or `none`), `currency`, `minPrice`/`maxPrice` (need `currency`), `from`/`to` (YYYY-MM-DD), `tz` (IANA zone for date filters), `tag`, `status` (`active`\|`deleted`). `meta: { page, pageSize, total, totalPages }` |
| `POST /items` | Body: `{ name, price, currency, quantity?, categoryId?, sku?, description?, supplier?, purchaseDate?, tags? }`. Optional header `Idempotency-Key` (8–64 chars `[A-Za-z0-9_-]`): repeating it returns the original item with `200` and `Idempotent-Replayed: true` |
| `GET /items/:id` | Item plus `priceHistory` (newest first) |
| `PATCH /items/:id` | Any item fields plus required `version`. `409 VERSION_CONFLICT` if the item changed since it was read. Changing `currency` requires `price` |
| `DELETE /items/:id` | Moves to trash |
| `POST /items/:id/restore` | Restores from trash |
| `DELETE /items/:id/permanent` | Permanently deletes an item that is in the trash |
| `POST /items/bulk` | `{ action: "delete" \| "restore" \| "purge", ids }` or `{ action: "setCategory", ids, categoryId }` (≤ 100 ids). `{ affected }` |

Item shape:

```json
{
  "id": "uuid", "name": "Desk lamp", "price": "1499.00", "priceMinor": "149900", "currency": "INR",
  "quantity": 1, "lineTotal": "1499.00", "category": { "id": "uuid", "name": "Home", "color": "blue" },
  "sku": null, "description": null, "supplier": null, "purchaseDate": "2026-10-01", "tags": ["office"],
  "version": 1, "createdAt": "…", "updatedAt": "…", "deletedAt": null
}
```

## Categories (`/categories`, signed in)

`GET /categories` · `POST /categories { name, color }` · `PATCH /categories/:id { name, color }` ·
`DELETE /categories/:id` (items become uncategorised). Names are unique per user, case-insensitively.

## Insights (`/insights`, signed in)

| Method & path | Notes |
| --- | --- |
| `GET /insights/overview` | Totals per currency (`totalValue`, `averagePrice`, `highest`, counts), recently added/updated, trash and category counts |
| `GET /insights/analytics` | Query: `from`, `to`, `granularity` (`day`\|`week`\|`month`), `currency`, `tz`. Collection value per bucket, value changes by cause, items added, category and price distributions, top items, recent price changes |
| `GET /insights/activity` | Query: `page`, `pageSize`, `scope` (`all`\|`items`\|`security`\|`data`) |
| `GET /insights/notifications` | `meta.unread` holds the unread count |
| `POST /insights/notifications/read` | `{ ids }` or `{ all: true }` |

## Data (`/data`, signed in)

| Method & path | Notes |
| --- | --- |
| `GET /data/export?format=csv\|pdf&…` | Accepts the same filters as `GET /items`. CSV is UTF-8 with BOM, formula-safe. PDF includes up to 2,000 rows |
| `POST /data/import` | `{ csv, commit, defaultCurrency, createMissingCategories }`. With `commit: false` validates only. Required columns: `name`, `price` |
| `GET /data/account-export` | Full JSON export of the account |
