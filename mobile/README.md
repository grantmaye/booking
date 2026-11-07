# Chairside for iPhone and Android

A native React Native / Expo SDK 58 app, sharing the existing Node/SQLite backend. It is not a WebView wrapper. Customer and staff experiences live in the same app; the signed-in account controls available tools. Hosting, developer-account setup and store publishing are deferred.

## Included workflows

- Customer or guest booking, multiple services, location/professional selection, live availability, review and confirmation, and guest confirmation-link sharing.
- Signed-in appointment history, rescheduling, policy-enforced cancellation, waitlist signup, profile and marketing-consent editing, loyalty points, membership balances, receipts and studio conversations.
- Staff daily schedules and professional filters, scoped client search/history, check-in, cancellation and no-show actions. Professionals see only their assigned appointments and related clients.
- Owner/manager/receptionist client creation/editing, conversations, checkout totals, tips, cash settlement and Stripe-hosted card checkout. The backend is authoritative for payment and appointment status.
- Clock-in/out for professionals; operators can choose the professional.
- Keychain/Keystore session storage, seven-day server sessions hashed at rest, existing MFA enforcement, revocation on logout/password reset/account disable, and no persistent caching of client records.
- Electric Editorial styling: ink, paper, citron, locally bundled Barlow typography, large touch targets and native safe-area/keyboard handling.

This companion app focuses on daily booking and studio work. Inventory purchasing, marketing campaign creation, financial reports, team invitations and business configuration remain in the web workspace. Remote push notifications, background synchronization, offline writes, universal email links, native payment hardware and app-store account-deletion workflows are not implemented. Email verification/recovery use the existing web links. Provider-dependent features require the same configured backend credentials as the website.

## Local development

Requires Node 24+, npm and the platform's native build tools. Install dependencies separately from the backend:

```sh
# Repository root
npm ci
npm run demo:mobile

# Separate terminal
cd mobile
npm ci
npm run android
# or: npm run ios
```

The explicit mobile demo binds to your LAN on port 3002 and uses only `data/mobile-demo.sqlite`. It refuses production mode. Do not expose that demo server to the internet. It creates these fictional accounts, all with password `chairside-mobile-demo`:

| Email                     | Role                            |
| ------------------------- | ------------------------------- |
| `customer@chairside.test` | Customer                        |
| `staff@chairside.test`    | Professional assigned to Marcus |
| `owner@chairside.test`    | Owner                           |

In the app, open Account → Change studio connection:

- iPhone simulator: `http://127.0.0.1:3002`
- Android emulator: `http://10.0.2.2:3002`
- Physical phone on the same Wi-Fi: `http://<computer-LAN-IP>:3002`

Use a development build, not an assumption that Expo Go contains every native module. Development builds allow local HTTP; release connections require HTTPS. Changing servers revokes the current session before clearing in-memory records. SecureStore errors and unreachable studios are surfaced rather than silently losing credentials or pretending a mutation succeeded.

### Browser preview

To review the same React Native screens without native tooling, keep the demo backend running and run:

```sh
cd mobile
npm run preview:web
```

Open `http://127.0.0.1:8082`. This loopback-only preview proxies API requests to port 3002. It keeps login tokens in memory only, so reloading signs you out. It is development tooling, not a deployment target. It does not change the website's CORS or security policy.

## Validate

```sh
# Repository root: backend and native-session regressions
npm run check
npm test

# mobile/
npm run check
npm run lint
npm test
npx expo-doctor
npm run export
```

The export command compiles iOS and Android Hermes bundles and a browser bundle. It is not a signed `.ipa` or `.aab`. `npm run android` and `npm run ios` generate native projects from `app.config.ts`; generated native directories stay out of Git. Do not hand-edit them.

## Later: hosting and distribution

1. Deploy the existing backend with persistent SQLite storage, HTTPS and production credentials. Do not change its architecture just to host the app.
2. Set `EXPO_PUBLIC_API_URL` to that HTTPS origin. This is a public URL, never a secret. No backend API secrets belong in mobile environment variables.
3. Confirm bundle identifiers, branding and developer accounts. The current identifiers are `com.grantmaye.chairside`.
4. Configure an Expo project and use `eas.json`: `development` for devices, `simulator` for iOS simulator, `preview` for internal distribution, `production` for stores. No Expo project, paid cloud build or store submission has been created by this work.
5. Validate real devices, MFA restore, accessibility, payment-return behavior and providers against the hosted backend. Prepare privacy policy, store disclosures, support contact and account-deletion flow before submission. Do not claim store readiness from bundle compilation alone.

Production cloud builds reject an unset or non-HTTPS backend URL. Native secure storage intentionally does not restore Android credentials after uninstall. Server revocation is authoritative; if a sign-out cannot reach the backend, the app reports that failure instead of claiming the token was revoked.

## Source

- `src/app/`: Expo Router screens and tab navigation.
- `src/components/ui.tsx`: reusable bold design system.
- `src/lib/session.tsx`: connection, secure session, role-scoped refresh and foreground synchronization.
- `src/lib/api.ts`: transport, timeout/error handling, date and currency formatting.
- `scripts/brand-assets.mjs`: reproducible app icons from the Chairside mark.
- `scripts/preview.mjs`: local browser-preview server.
- `../test/mobile.test.mjs`: full backend HTTP tests for native authentication, booking and role boundaries.
