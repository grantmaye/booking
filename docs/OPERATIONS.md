# Operations and release gates

## Current architecture

Node 24's built-in HTTP server and SQLite driver serve the API and static frontend. The browser stores no business database or password. SQLite uses WAL, foreign keys, a busy timeout, and `BEGIN IMMEDIATE` before checking/writing appointment capacity. Nested operations use savepoints. Recurring reservations commit as one transaction.

Business records use a typed-kind JSON table; appointments/payments/sales have dedicated tables. This keeps the first release small, but schema migrations, database-level references for all record IDs, and stronger record-specific schemas should precede large-scale use.

The app is a **single-business, owner-operated application**, not a multi-tenant SaaS. All signed-in owners have full access. Staff records do not create user accounts or staff-level authorization.

## Security model

Passwords use scrypt with a unique random salt. Session tokens have 256 bits of randomness, expire in seven days, and use HttpOnly/SameSite cookies; production adds Secure. First-owner setup should happen on a private interface or require `SETUP_TOKEN`. Production first boot refuses to run without a setup token. Never expose the demo database.

Mutating requests with a foreign Origin are rejected. JSON requests from browsers do not receive permissive CORS headers. CSP prevents external scripts and framing by foreign origins. Request bodies are bounded. Authentication and public booking endpoints have in-memory rate limits by socket address. A reverse proxy needs its own rate limiting; proxy-forwarded IP headers are not trusted.

Customer management links are bearer capabilities: anyone with the link can see the service/staff/time and cancel within policy. They are not client-account authentication. Avoid logging or sharing their fragment tokens. Public bookings create separate client profiles rather than trusting an unverified email to identify a returning customer. Manual profile merging is not yet implemented.

## Required before a real launch

1. Replace the fictional catalog, addresses, and clients. Confirm hours, timezone, cancellation rules, service prices, and currency.
2. Deploy behind HTTPS, configure exact `PUBLIC_ORIGIN`, initialize the owner securely, and protect the persistent volume.
3. Implement staff authorization if anyone other than the owner needs access.
4. Add password recovery and account lifecycle controls.
5. Add backup scheduling and a tested restore procedure. Use SQLite's online backup API or a consistent database backup; do not copy only the main file while WAL writes are active.
6. Implement provider-backed payments before offering online payments, deposits, refunds, memberships, or gift-card value. Verify signed webhooks, idempotency, payment states, and reconciliation. Never store card numbers.
7. Implement opted-in messaging and unsubscribe handling before enabling marketing. Process the notification outbox with retries and delivery callbacks. Current notification records do not send anything.
8. Add tax/discount policy, historical commission snapshots, and financial reconciliation before relying on reports for payroll or accounting.
9. Complete accessibility, load, privacy, security, and browser compatibility testing. Automated tests and manual browser checks are not a production audit.

## Known limits

- USD only; all locations share one business timezone.
- Day calendar visually displays 09:00–20:00. Booking policy supports wider hours, so widen the calendar before configuring earlier/later hours.
- Service duration/price is snapshotted into existing bookings, while report display names and commission rates use current records.
- Retail inventory and revenue are shared across locations.
- No payment-provider, mail-provider, bank, Google, Instagram, or app-store credentials are configured.
- Duplicate public submissions can create separate visits at different available times; overlap protection prevents simultaneous identical reservations, but general request idempotency keys are not implemented.
- Database initialization is idempotent, but there is no versioned migration framework yet.
- The application is not deployed; the Docker definition is supplied but unverified.
