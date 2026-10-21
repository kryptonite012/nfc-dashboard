# Backups and restoration

All VaultLedger state lives in PostgreSQL. Back up the database; the application container is stateless.

## Recommended policy

| Item | Recommendation |
| --- | --- |
| Automated backups | Daily snapshots from your managed provider (Neon, Supabase, RDS, Render, Railway…) |
| Point-in-time recovery | Enabled, with at least 7 days of WAL retention |
| Retention | 30 days (state this in your Privacy Policy, since deleted accounts persist in backups until they expire) |
| Off-site copy | Weekly logical dump (`pg_dump`) to separate, encrypted object storage in another region/account |
| Encryption | Provider-managed encryption at rest; encrypt dumps (e.g. `age` or server-side KMS) |
| Restore drill | Quarterly: restore into a scratch database and run the checks below |

## Logical backup with pg_dump

```bash
# Custom-format dump (compressed, restorable selectively)
pg_dump --format=custom --no-owner --no-privileges \
  --file="vaultledger-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"

# Optional: encrypt before uploading
age -r <recipient-public-key> -o backup.dump.age backup.dump
```

Use a read-only database role for backups where your provider allows it.

## Restoring

> Restore into a **new, empty database** first. Never restore over the live database until the restored copy
> has been verified.

```bash
createdb vaultledger_restore            # or create one in your provider's console
pg_restore --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" vaultledger-YYYYMMDDTHHMMSSZ.dump

# Confirm the schema is at the latest migration (applies nothing if already current)
DATABASE_URL="$RESTORE_DATABASE_URL" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Managed providers: use the console's "restore to point in time" or "restore snapshot" feature, which creates a
new database instance; then follow the verification and cut-over steps.

### Verify the restored copy

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM items WHERE deleted_at IS NULL;
SELECT max(created_at) FROM activity_log;           -- how recent is the data?
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;
```

Then point a staging instance of the app at it and sign in with a test account.

### Cut over

1. Put the service in maintenance (scale to zero or block traffic at the proxy).
2. Point `DATABASE_URL` at the restored database (or rename databases).
3. Start the service, check `GET /api/ready`, and run the smoke test from DEPLOYMENT.md.
4. Sessions are stored in the database, so users signed in before the restore point stay signed in;
   sessions created afterwards are lost and those users sign in again.

## What a restore cannot bring back

- Emails/SMS already sent.
- Data created after the restore point (use point-in-time recovery to minimise this window).
- Accounts deleted before the backup was taken.

## Account deletion and backups

When a user deletes their account it is removed from the live database immediately. It remains in backups
until they age out (30 days with the policy above). If you restore a backup taken before a deletion, delete
the account again after the restore; keep a log of deletion requests (user id and time, without other data)
so this can be done reliably.
