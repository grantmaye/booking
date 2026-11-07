# Chairside

A service-booking and studio-management web application for independent shops and multi-location businesses. Built for `grantmaye/booking`, with original branding and interface.

Customer booking and accounts, role-based staff access, scheduling, checkout, inventory, memberships, marketing delivery, and deployment tooling are implemented. See [feature coverage](docs/FEATURES.md) for the precise behavior and boundaries; this repository does not claim complete Squire product parity.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run demo
```

Open http://127.0.0.1:3001 with `demo@example.com` / `chairside-demo-only`. This isolated, loopback-only demo uses fictional records in `data/demo.sqlite` and refuses production mode.

For development with a separate database, run `npm start` and create the first owner at http://127.0.0.1:3000. Development seeds a fictional catalog. Production starts with an empty catalog and requires setup secrets.

## What is included

- Public booking with multiple services, group reservations, private management links, rescheduling, cancellation policies, waitlist signup and expiring claim offers.
- Customer registration/verification, password recovery, private portal, booking history, profile, studio conversations and membership billing management.
- Day/week/month calendar, drag-to-reschedule, recurring series and rolling renewal, shifts, time off, service buffers, chairs/rooms and multi-location staff, prices and timezones.
- Owner, manager, receptionist, professional and customer roles; single-use invitations, account disabling, encrypted authenticator secrets and MFA.
- Immutable checkout orders; cash, gift cards, cash/gift split tender, Stripe-hosted card checkout, deposits, taxes, promotions, loyalty redemption, receipts and full refunds.
- Cash-funded gift issuance with a liability ledger, transactional redemption and refunds. Stripe subscription renewals, membership credits and failed-payment state.
- Inventory reservations, stock adjustments/transfers, suppliers, purchase orders, receiving and returns.
- Client import/merge, consent management, queued campaigns, confirmation/reminder worker, delivery retries, signed email callbacks and unsubscribe links.
- Commission snapshots, timesheets, date/location reports, branding, public portfolio uploads and an installable web manifest.
- Versioned migrations, Docker/Caddy deployment, persistent volumes, health checks, online backups, safe restore, CI and fresh-production smoke tests.

## iPhone and Android

The native companion app lives in [`mobile/`](mobile/README.md). It includes customer booking and visit management, staff schedules and client records, checkout, messaging and shift controls with the same bold Chairside branding. It shares this backend and keeps its SQLite architecture. Use `npm run demo:mobile` for an isolated local mobile demo. Hosting and store publishing remain deferred.

## Marketing and analytics

The workspace now includes campaign templates, audience segments, draft editing, scheduled email, delivery/open/click reporting, booking-source analytics, a tracked-link builder and CSV export. The Integrations directory provides setup panels for Resend, Stripe, consent-gated Google Analytics 4, the Twilio transport and CSV workflows. See [marketing setup and reporting definitions](docs/MARKETING.md).

## Deploy

Use one application instance on a VM/container host with persistent storage. This is a single-business application with multiple locations, not a hosted multi-tenant SaaS.

```sh
cp .env.example .env
# Set independent APP_SECRET and SETUP_TOKEN values, your domain and provider credentials.
npm run deploy:check
docker compose --profile https up -d --build
```

Point your domain at the host and allow inbound 80/443. Caddy provisions HTTPS. Open your public origin, enter the setup token, and create the owner. Add the real locations, services and staff. The container runs as a non-root user with a read-only root filesystem.

Read [the deployment and recovery runbook](docs/OPERATIONS.md) before launch. Stripe/Resend/Twilio accounts and credentials are not included. Their code paths are present, but live transactions and delivery have **not** been verified against your provider accounts. No public deployment has been created.

## Verify

```sh
npm run check
npm test
npm audit --omit=dev --audit-level=high
docker build -t chairside:verify .
npm run test:release
```

The release test uses disposable Docker resources and checks an empty production database, secure owner session, persistence across restart, and backup/restore integrity. See [verification evidence](docs/VERIFICATION.md).

## Source map

- `db.mjs`: SQLite and transactional appointment engine.
- `server.mjs`: HTTP server, sessions, catalog and base routes.
- `lib/`: access control, commerce, payments, delivery, recurrence, waitlist, migrations and extended APIs.
- `public/`: responsive workspace, booking pages and customer portal.
- `scripts/`: syntax checks, demo, deployment checks, backup/restore and production smoke test.
- `test/`: booking, concurrency, commerce, security and HTTP regression coverage.

Chairside is not affiliated with Squire. Reference baseline: [Squire features](https://www.getsquire.com/pricing).
