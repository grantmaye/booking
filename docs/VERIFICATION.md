# Verification — November 6, 2026

## Release checks

- `npm run check`: passed, 27 JavaScript modules syntax checked.
- `npm test`: **42 passed, 0 failed**.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities** in installed production dependencies.
- `docker build -t chairside:verify .`: passed using Node 24 Bookworm slim.
- `npm run test:release`: passed with a disposable non-root/read-only production container and isolated persistent volume. Verified empty production catalog, owner setup, Secure session cookie, persisted record after restart, online backup, exclusive restore and SQLite integrity.
- `git diff --check`: passed.

## Regression coverage

Booking capacity across independent database connections, rollback, buffers/time off/shifts, timezone and DST handling, multi-service pricing, resource conflicts, recurring extension idempotency, waitlist claim/expiry, account role isolation, invitation/recovery token use, MFA and encrypted secrets, server-calculated taxes/promotions, inventory reservations/transfers/receipts, split cash/gift tender, deposit application/refunds, gift issuance liability/refunds, membership/loyalty balances, outbox retry/consent, and signature validation for Stripe and email events.

Financial race tests hold provider completion behind an explicit promise: cash settlement is rejected while Checkout creation is in progress. Another test delivers a paid webhook before the Checkout create request returns and proves payment is recorded exactly once. Applied card deposits are rejected before reaching the provider refund API. The tests use local mock provider responses; no live charges/refunds/messages are sent.

## Browser checks

Using the isolated local demo with fictional data:

- Original owner login, public booking/cancellation, cash checkout, recurring visits and retail deduction were checked in the initial implementation.
- Expanded order creation and cash settlement verified.
- Calendar week view and consolidated workspace navigation rendered.
- Chair/resource creation and subsequent editing persisted and rendered.
- Public haircut + beard booking showed a combined $75 total and confirmed successfully.
- Customer self-rescheduling moved that multi-service appointment to the new date; confirmation displayed both services.
- Deposit order creation and cash settlement showed a paid $20 deposit.
- Date-range reports rendered totals and commission/retention results.
- Initial customer booking layout was inspected at a 390 × 844 viewport with no horizontal page overflow. The expanded screens were inspected at the browser's current narrow viewport; a complete device/browser accessibility matrix has not been run.

Screenshots: `docs/screenshots/checkout.jpg`, `docs/screenshots/operations.jpg`, plus the earlier `dashboard.jpg`. Screenshots contain only local demo records. UI polish after capture adds distinct navigation symbols and more useful short deposit IDs.

## Not established by these checks

No cloud deployment, live provider acceptance test, penetration test, load certification, statutory tax/payroll audit, or native-store distribution has been performed. Provider secrets are deliberately absent. Run the provider activation tests in `OPERATIONS.md` before accepting real payments or enabling delivery. GitHub CI independently repeats syntax, unit/HTTP tests, audit, container build and the release drill on each push.

## Marketing expansion verification

- 50 tests pass after the marketing and analytics additions; 33 JavaScript modules pass syntax checks.
- Consent-gated Google loading is tested without contacting Google; source URLs omit query strings and private pages are excluded.
- Browser verified template draft creation, source-link generation and integration setup guidance. Mobile Marketing width was 390px at a 390px viewport.
- No external campaigns or provider connection changes were performed. Screenshots: `marketing.jpg` and `integrations.jpg` under `docs/screenshots/`.
