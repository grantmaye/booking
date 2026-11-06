# Verification — November 6, 2026

- `npm run check`: passed for server, database module, and browser JavaScript.
- `npm test`: 18 tests passed, 0 failed.
- Concurrent reservations: two independent SQLite connections attempted one staff/time slot; exactly one succeeded, the other received an availability conflict, and one appointment persisted.
- HTTP lifecycle: owner setup token, session cookie, unauthenticated rejection, hostile-origin rejection, record validation, public booking, overlap rejection, checkout, cancellation, and logout passed against an isolated temporary database.
- Desktop browser: owner login, customer booking confirmation, customer cancellation, cash checkout with a tip, recurring booking, calendar display of the second occurrence, and retail stock deduction verified.
- Mobile browser: customer booking inspected at 390 × 844; document width equaled viewport width (390 px). A heading spacing issue was corrected and rechecked.
- Dashboard screenshot: `docs/screenshots/dashboard.jpg`, using fictional records from the isolated demo.

The concurrency test uncovered a database initialization lock race; busy timeout is now configured before the WAL pragma, and workers close before the final verification connection opens.

Not verified: Docker build, cloud deployment, payment/messaging integrations, full WCAG audit, load testing, restore drills, native mobile distribution, and long-running production behavior. CI is configured separately; local test results do not imply a completed remote CI run.
