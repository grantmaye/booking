# Chairside

A working service-booking and studio-management application built for `grantmaye/booking`, inspired by Squire's business workflows with original branding and UI.

**This is a functional first release, not complete Squire parity or a production-certified replacement.** It has a real HTTP backend, authenticated workspace, persistent SQLite storage, and transactional scheduling. Provider-dependent and unfinished features are listed explicitly in [the feature matrix](docs/FEATURES.md).

## Run locally

Requires **Node.js 24+**. No npm dependencies or build step.

```sh
npm start
```

Open **http://127.0.0.1:3000** and create your owner account. The customer booking page is **http://127.0.0.1:3000/book**.

The initial catalog contains fictional Charlotte studios, staff, clients, services, and products. It does not contain default owner credentials. Replace these records before using real business data. SQLite files live in `data/` and are excluded from Git.

## Explore the isolated demo

```sh
npm run demo
```

Open **http://127.0.0.1:3001**. Sign in using `demo@example.com` / `chairside-demo-only`.

Demo mode uses a separate `data/demo.sqlite` database, binds only to loopback, and refuses to run with `NODE_ENV=production`. These are deliberately public demo credentials, not production credentials.

## Included workflows

- Customer self-booking by location, service, professional, date, and live available slot.
- Private booking confirmation links and policy-aware cancellation.
- Owner day calendar, appointment creation, rescheduling, check-in, cancellation, and no-show handling.
- Weekly, biweekly, and four-week recurring bookings, with all-or-nothing conflict handling and daylight-saving-aware local times.
- Multiple locations, business hours, staff assignment, service prices/durations/buffers, and time-off blocks.
- Client profiles, preferences, visit history, spend, consent flags, and earned loyalty points.
- Cash service checkout, tips, duplicate-payment prevention, and payment history.
- Retail cash sales with atomic stock deduction and low-stock alerts.
- Waitlist records, membership plans/enrollments, gift-card balances, booth-rent ledgers, and marketing drafts.
- Revenue reports, commission estimates, CSV export, and authenticated mutation audit history.
- Responsive layout and keyboard-accessible native form controls and dialogs.

Cash checkout **records money already received**; it does not move funds. Membership, gift-card, rent, and waitlist records are manually managed; they are not automated billing or redemption systems. No email or SMS is sent.

## Verification

```sh
npm run check
npm test
```

The tests cover availability, overlap prevention, buffer time, time off, rollback, checkout, loyalty, recurring appointments across DST, retail stock transactions, and an isolated HTTP lifecycle including authentication and origin protection. HTTP tests bind a temporary loopback port and delete their temporary database afterward.

## Configuration

| Variable        | Default                 | Purpose                                                           |
| --------------- | ----------------------- | ----------------------------------------------------------------- |
| `HOST`          | `127.0.0.1`             | Listening interface                                               |
| `PORT`          | `3000`                  | HTTP port                                                         |
| `DB_PATH`       | `data/chairside.sqlite` | Durable database path                                             |
| `NODE_ENV`      | unset                   | Set `production` to require secure cookies                        |
| `PUBLIC_ORIGIN` | unset                   | Exact HTTPS origin allowed behind a reverse proxy                 |
| `SETUP_TOKEN`   | unset                   | First-owner setup secret; required on a fresh production database |

## Deployment

A container definition is included. Deploy a **single application instance with persistent local storage** behind an HTTPS reverse proxy. Set `NODE_ENV=production`, `PUBLIC_ORIGIN`, and a strong `SETUP_TOKEN` before first boot. Enter the token during owner setup. Mount `/app/data` on a persistent volume writable by UID 1000. Do not run `npm run demo` on a publicly reachable service.

```sh
docker build -t chairside .
docker run --env-file .env -p 3000:3000 -v chairside-data:/app/data chairside
```

The container has not been built or deployed in this environment. Before accepting real customers, complete the release gates in [docs/OPERATIONS.md](docs/OPERATIONS.md). There is no live cloud deployment in this repository's initial delivery.

## Code map

- `db.mjs`: schema, catalog seed, transactional booking and payment logic.
- `server.mjs`: HTTP routing, authentication, validation, public/private APIs.
- `public/app.js`: owner workspace and customer booking UI.
- `public/style.css`: responsive visual system.
- `test/`: backend and HTTP regression tests.
- `docs/FEATURES.md`: implemented, partial, and missing Squire-style features.
- `docs/OPERATIONS.md`: deployment limits, security model, and integration requirements.

Reference baseline: [Squire feature catalog](https://www.getsquire.com/pricing), [scheduling](https://www.getsquire.com/features/scheduling), and [multi-location management](https://www.getsquire.com/features/multi-location), reviewed November 6, 2026. Chairside is not affiliated with Squire.
