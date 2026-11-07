# Mobile verification

Local verification, November 6–7, 2026. All mutations used the isolated fictional mobile database or disposable test databases. No live providers, hosting or app stores were used.

## Automated

- Backend: 56 passing tests, including native-session hashing, browser-cookie separation, MFA, expiration, logout, password-reset revocation and disabled-account rejection.
- Customer scope: mobile booking ignores a forged client ID, multi-service history is retained, another customer cannot modify the appointment or exclude it from availability, and conversation reads are scoped to the signed-in client.
- Staff scope: professionals only see their assigned visits, cannot modify another professional's visit, cannot collect payments or read operator conversations, and cannot clock in as another professional.
- Checkout: operator order lookup, idempotent order creation, cash settlement, completed visit and customer receipt.
- Mobile transport: 5 passing tests for HTTPS enforcement, unsafe URL rejection, header-only bearer credentials, blocked redirects, cookie omission, error handling and timezone/currency formatting.
- TypeScript and Expo ESLint passed. Expo Doctor passed all 20 checks.
- iOS and Android Hermes bundles compiled. Android native Gradle development build succeeded and the APK was installed in the existing Android emulator. After correcting the local dev-server address, the native Android bundle loaded and the runtime logs contained no JavaScript or fatal Android errors. iOS native project generation succeeded; CoreSimulator discovery timed out after 300 seconds, so no native iPhone simulator test or signed IPA is claimed.

## Interactive browser preview of the React Native screens

At a 390 × 844 phone viewport (also checked at 360 × 800 with no horizontal overflow):

1. Customer sign-in against the local backend.
2. Live availability → review → confirmed booking → persisted visit list.
3. Customer conversation message saved and displayed.
4. Sign-out and owner sign-in; staff navigation replaced the customer tabs.
5. Staff check-in → order with $5 tip → $50 cash settlement → paid receipt.
6. Customer sign-in showed 45 loyalty points earned from the paid service.
7. Another booking was rescheduled from November 11 at 9 AM to November 12 at 10 AM, then cancelled; both changes were verified on the visit screen.
8. Reloading the browser preview cleared its memory-only token; checkout correctly refused signed-out access.

Screenshots are in `docs/screenshots/mobile-*.png`. These are browser renders of the native components, not iPhone or Android screenshots.

## Remaining validation before distribution

- Real-device and native simulator interaction testing on both platforms, including secure storage across restarts, keyboard/safe-area behavior and accessibility.
- Hosted HTTPS backend, configured email, Stripe sandbox/live acceptance, payment-return behavior, and server backups.
- Signing, store account setup, privacy/disclosure documents, account deletion and store review. Remote push notifications are not implemented.
- The SDK dependency audit reports moderate advisories in Expo/ESLint transitive glob/minimatch tooling; no high or critical production dependency findings. The package manager's suggested forced fix downgrades Expo several major versions and was not applied. Recheck upstream patches before store release.
