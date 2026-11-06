# Feature implementation status

This matrix distinguishes working behavior from records/UI that still need business logic or external integrations. It is not a claim of full parity.

| Area           | Delivered                                                                                                          | Remaining                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Booking        | Customer service/staff/location selection, live slots, confirmation, secure cancellation link                      | Customer account portal, group appointments, multi-service cart, customer rescheduling                                            |
| Scheduling     | Owner day calendar, rescheduling, statuses, time off, service buffers                                              | Week/month views, drag-and-drop, per-staff recurring shifts, resource/chair assignment                                            |
| Recurrence     | Owner weekly/biweekly/four-week series, transactional rollback, local wall-time across DST                         | Series-level editing/cancellation and indefinite recurrence                                                                       |
| Locations      | Multiple shop records, hours, staff location, calendar/report filters                                              | Cross-location staff assignments, independent timezones, location-specific service pricing                                        |
| CRM            | Profiles, preferences, history, spend, consent, points                                                             | Profile merge, imports, photos, retention cohorts, client messaging                                                               |
| POS            | Cash service checkout, tips, receipts ledger, cash retail sales, stock deduction                                   | Card/wallet payments, taxes, discounts, deposits, refunds, split tender, gift-card redemption, printed receipts, payment hardware |
| Inventory      | Product CRUD, quantities, low-stock alerts, retail sales                                                           | Location-specific inventory, suppliers, purchase orders, returns, stock movement history                                          |
| Loyalty        | Earn one point per service dollar                                                                                  | Redemption rules, rewards, expiration, tiers                                                                                      |
| Memberships    | Editable plans and manual enrollment/credit ledger                                                                 | Automatic billing, credit redemption/renewal, payment failure handling                                                            |
| Gift cards     | Manual code and balance ledger                                                                                     | Issuance/payment workflow, atomic redemption, validation and uniqueness policy                                                    |
| Waitlist       | Manual client/service/date records and statuses                                                                    | Automatic matching, notifications, claim holds, public waitlist signup                                                            |
| Marketing      | Consent fields and editable campaign drafts                                                                        | Email/SMS provider, sending, unsubscribe handling, automation, delivery webhooks                                                  |
| Reminders      | Booking-confirmation outbox records marked pending-provider                                                        | Scheduled reminder worker, retry/idempotency policy, actual delivery                                                              |
| Staff          | Professional profiles, active state, commission rates                                                              | Staff logins, role permissions, timesheets, schedules, payroll                                                                    |
| Rent/payouts   | Manual booth-rent ledger and commission estimates                                                                  | Automated collection, bank onboarding, payouts, historical commission rates                                                       |
| Reports        | Recorded service revenue, tips, retail totals, staff comparison, CSV                                               | Date-range dashboards, retention, tax accounting, per-location retail reports                                                     |
| Brand          | Original responsive booking page and workspace                                                                     | Website editor, portfolio upload, branded native mobile apps                                                                      |
| Distribution   | Direct booking URL                                                                                                 | Google/Instagram booking integrations, marketplace                                                                                |
| AI             | None; no generated insights presented as measured data                                                             | AI receptionist, call routing, supervised recommendations                                                                         |
| Financing      | None                                                                                                               | Provider/legal/compliance arrangement required                                                                                    |
| Security       | Owner password hashing, expiring HttpOnly sessions, same-origin mutations, rate limits, setup token, audit records | Staff RBAC, MFA, password recovery, distributed rate limiting, compliance review                                                  |
| Infrastructure | Single-instance SQLite backend, test suite, CI workflow, Dockerfile                                                | Live deployment, backups/restore drills, monitoring, migration tooling, scalability testing                                       |

## Beneficial additions already included

- All-or-nothing recurring series: a conflict in any occurrence prevents the entire series from being partially booked.
- Availability respects the business timezone and preserves recurring local times across DST.
- Public booking cannot overwrite an existing customer's profile by supplying that customer's email.
- Double checkout and overselling are rejected transactionally.
- CSV formula prefixes are neutralized when exporting user-entered text.
- External services remain visibly disconnected until a real implementation exists.
