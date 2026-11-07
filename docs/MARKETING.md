# Marketing, analytics and integrations

Open **Marketing**, **Marketing analytics**, or **Integrations** in the workspace navigation. These pages are restricted to owners and managers. Google Analytics settings can only be changed by the owner.

## Campaign workflow

1. Choose a starter (studio news, win-back, or loyal-client thank-you) or create a new campaign.
2. Write a plain-text subject/message and select an audience. Save and edit the draft as needed.
3. Open **Preview & schedule** to review the message and eligible recipient count. Choose a local send time, or leave it blank for the next worker cycle.
4. The server snapshots eligible recipients and queues each unique email once. Delivery rechecks opt-in consent. A tracked booking link and signed unsubscribe link are appended automatically.
5. Use **Stop pending** to suppress unsent pending/retry messages. Delivered or in-flight messages cannot be recalled. A queued/cancelled campaign cannot be sent again; create another draft.

Audiences: all opted-in clients; no completed visits; at least two completed visits; last completed visit at least 60 days ago; at least five completed visits. Counts depend on client profiles and recorded completed appointments. Merge duplicate profiles for accurate history; email deduplication alone does not merge their visits.

Set `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `APP_SECRET`, `PUBLIC_ORIGIN`, and `RUN_WORKER=true` on the server. Restart after environment changes. Scheduling is blocked without the sending provider and worker. No matching recipients also blocks queueing. A scheduled campaign's retry window begins at delivery time, not at draft creation.

Delivery/open/click totals use signed Resend callbacks. Enable provider tracking if you want open/click events, and register `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, and `email.failed`. Counts are unique outbox recipients per event type; repeated callbacks do not inflate them. Opens/clicks may include privacy proxies and bots. Missing events mean unknown engagement, not proof that nobody read the email. Campaign totals are lifetime; attributed appointments follow the selected analytics date window. [Resend event documentation](https://resend.com/docs/dashboard/webhooks/event-types).

No email or SMS was sent during implementation. Templates are drafts, not enabled recurring automations. Automatic SMS campaigns, A/B tests, ad buying and recurring nurture sequences are not implemented.

## First-party analytics

Marketing analytics shows bookings, completed visits, no-shows, booked service value, bookings by day and source performance. The window uses **appointment dates in UTC**; campaign delivery totals remain lifetime. Booked value excludes cancelled/no-show visits and is not cash collected, margin, or return on ad spend. Use Reports for financial totals.

The link builder produces `/book?utm_source=...&utm_medium=...&utm_campaign=...`. Tags are stored with a successful appointment, not with anonymous browsing. There is no backfill for earlier bookings. Untagged appointments are grouped as direct/untracked. Labels accept up to 80 letters, numbers, spaces, underscores, periods or hyphens; never put personal data into tags. Tags are self-reported attribution and can be modified by the visitor; they do not establish causation. Automatic campaign links use the campaign ID for attribution.

Source reports export CSV for spreadsheet and BI imports. This is a manual export, not a live Mailchimp/HubSpot/BI synchronization.

## Google Analytics 4

In Integrations → Google Analytics 4, save a `G-` measurement ID. Blank disables tracking. Disable automatic **Enhanced Measurement** events in the web stream; Chairside supplies explicit sanitized `page_view` and `booking_complete` events. The public pages `/studio`, `/book`, `/group`, and `/waitlist` can show the consent prompt. The explicit booking-complete event currently covers the main `/book` workflow, not group or account bookings.

Google's script is not loaded before consent. A declined choice also prevents loading. Consent choice is stored locally for 180 days and can be changed through **Analytics preferences**. Revoking consent disables collection and reloads the page; this does not erase historical data already held by Google. Public events omit query strings, referrers, contact fields and appointment identifiers. Account, management-token, recovery and workspace pages never load this integration. The first-party appointment reports work independently of Google consent.

This follows the Google tag's [explicit configuration API](https://developers.google.com/tag-platform/gtagjs/reference) and [basic consent model](https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic). Verify events in your own property before launch. No GA4 property was connected during development.

## Integration directory

- **Resend:** native email transport, campaign queue and signed delivery/engagement processing.
- **Stripe:** existing native hosted payments and membership billing integration.
- **Google Analytics 4:** configurable measurement ID and consent-gated public tracking.
- **Twilio:** existing SMS transport adapter only; no automated marketing or inbound messaging workflow.
- **CSV:** available source-report export and existing client import.

Each panel provides setup instructions, provider links and, where applicable, the exact webhook endpoint and missing environment variable names. Secret values are never returned to the browser. **Configured** means required values are present, not that authentication/delivery has been verified. Provider accounts, credentials and live acceptance tests remain deployment prerequisites.

## Verification

50 tests pass, including audience consent/deduplication, scheduling, send-time opt-out suppression, cancellation, signed engagement deduplication, source aggregation, owner-only configuration and the Google consent gate. The Google test uses a fake browser/network and verifies that query strings and private paths are not sent. Browser checks covered template → saved draft, booking-link generation, integration setup guidance, desktop layout and mobile page width (390px).
