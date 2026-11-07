# Deployment and recovery runbook

## Hosting

Node 24, one application process and a persistent local disk. SQLite uses WAL, foreign keys, a busy timeout, immediate write transactions and nested savepoints. Migrations run transactionally before serving traffic. Multiple branches/instances must not share the same database file. Ephemeral serverless filesystems are unsuitable.

1. Copy `.env.example` to `.env` (ignored by Git).
2. Generate **two independent** secrets using `openssl rand -hex 32`; set `APP_SECRET` and `SETUP_TOKEN`. Keep `APP_SECRET` backed up separately: it encrypts authenticator secrets and signs unsubscribe links. Changing it makes existing MFA secrets unreadable.
3. Set `APP_DOMAIN` to the hostname and `PUBLIC_ORIGIN` to its exact `https://` origin. Set `RUN_WORKER=true`, `SEED_DEMO=false`.
4. Run `npm ci` and `npm run deploy:check`. Missing optional providers appear as warnings, not fabricated readiness checks.
5. Point DNS to the host, permit TCP 80/443 and run `docker compose --profile https up -d --build`.
6. Check `docker compose ps` and `docker compose logs --tail 100 app`. Visit HTTPS, enter `SETUP_TOKEN`, and create the first owner. Production seeds no fictional data.
7. Configure locations, their IANA timezones, opening days/hours, tax rates, staff, services and cancellation window. Set up MFA and invite staff with the appropriate role. Test using non-customer sample records before taking bookings.

For an existing external HTTPS proxy, use `docker compose up -d --build app`; proxy to the loopback-only port 3000. Do not expose that HTTP port directly. The app trusts `PUBLIC_ORIGIN`, not arbitrary forwarded headers. IP rate limits see the proxy address; configure rate limiting at your edge for large deployments.

## Stripe activation

Set a sandbox key first, plus the endpoint signing secret. Use a restricted key with access to Checkout Sessions, subscriptions, invoices, billing-portal sessions, payment/refund operations used by the app. Never place a secret key in browser code.

Create a webhook endpoint at `/api/webhooks/stripe` for:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- `invoice.paid`, `invoice.payment_failed`
- `customer.subscription.updated`, `customer.subscription.deleted`
- `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`

Create recurring Prices for membership plans and enter each Price ID in Growth → membership editor. Configure Stripe's customer billing portal. Hosted Checkout handles payment details; the app stores provider identifiers, never card numbers. Test successful/failed/delayed payment, expiration, repeated delivery, membership renewal and a full refund in your Stripe sandbox. Then use separate live credentials and signing secret.

Online checkout reserves inventory. Until a signed success/failure/expiry arrives, staff cannot replace that order with cash settlement. Investigate undelivered webhook events in Stripe before retrying. Do not edit SQLite to mark payments paid. Refunds are full-order only. Provider-issued partial refunds require manual reconciliation because partial-refund bookkeeping is not implemented.

## Email, campaigns and worker

Configure `RESEND_API_KEY`, a verified `MAIL_FROM`, and `RESEND_WEBHOOK_SECRET`. Point the Resend webhook to `/api/webhooks/email` for delivered, bounced, complained and failed events. Verify an actual message to an address you control. Bounces and complaints disable that client's marketing consent. Campaign delivery rechecks consent immediately before sending; unsubscribe links are signed.

`RUN_WORKER=true` runs recurrence extension, waitlist matching and outbox processing every 15 seconds. The durable outbox has leases, retries and dedupe keys. Email delivery uses Resend idempotency keys. Pending reminders are suppressed on changes and replaced for the new visit time. Review failures in Messages and recurring conflicts in Operations. Retry manually only after investigating ambiguous provider delivery to avoid duplicates beyond the provider's dedupe window.

Twilio environment variables configure the SMS adapter. Automatic SMS enrollment and inbound SMS processing are not provided; do not treat email marketing consent as SMS consent.

## Backup and restore

Use the SQLite online backup API; copying only a live `.sqlite` file can omit WAL changes.

```sh
docker compose exec app node scripts/backup.mjs /app/backups/manual-2026-11-06.sqlite
docker compose cp app:/app/backups/manual-2026-11-06.sqlite ./manual-2026-11-06.sqlite
```

Use a unique filename each time. The script refuses overwrite, sets restrictive file permissions and runs `PRAGMA integrity_check`. Schedule this command with the host's backup system and copy encrypted backups off the host. Docker volumes alone are not disaster recovery. Define retention and monitor backup age; scheduling/offsite storage is not automatically provisioned.

Restore into a **new path**, preserving the old database and WAL files:

```sh
docker compose stop app
docker compose run --rm --no-deps app node scripts/restore.mjs /app/backups/manual-2026-11-06.sqlite /app/data/restored.sqlite
```

Change `DB_PATH` in the compose service environment to `/app/data/restored.sqlite`, then restart. Verify owner access, appointments, counts and provider event reconciliation. Restore is exclusive and refuses to overwrite existing files. Back up before upgrades; rollback code and data together if a schema migration is incompatible. Run `npm run test:release` periodically to exercise a fresh container/restart/restore drill.

## Security and operations

Passwords use salted scrypt. Seven-day sessions are HttpOnly/SameSite and Secure in production. Invites/recovery tokens are hashed, expire, and are single-use. MFA uses TOTP with encrypted stored secrets. Disabled users lose sessions. RBAC is enforced on the server, including per-professional and per-customer scope. Mutation requests reject foreign origins; responses have CSP and other security headers. Rate-limit counters persist in SQLite.

Manage links are bearer capabilities: anyone holding one can view/change that appointment within policy. Do not put their fragment tokens in logs or marketing analytics. Public guest bookings create separate profiles; merging is a staff action and refuses to combine separate account owners.

Monitor HTTPS `/api/health`, container health, disk capacity, backup age, webhook failures and outbox failures. Set a restart policy and host security updates. This release has automated and manual verification, not a penetration test, load certification or accounting audit. Keep uploads and the entire database volume private; public portfolio photos are deliberately published.
