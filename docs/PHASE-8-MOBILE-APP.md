# Phase 8: Mobile app (Expo, iOS and Android)

Status: FIRST VERSION BUILT. The sign-in and data layer is tested against the real server (9 checks). The screens typecheck, the whole app bundles for Android with Metro (Hermes bytecode, 2.6 MB), and `expo-doctor` passes 20 of 20 checks. The screens have NOT yet been run on a phone or simulator, so layout, camera and PDF picking are unverified (that needs your device or Android Studio / Xcode, see section 4).

## 1. What is in the app

One codebase in `apps/mobile` (Expo SDK 58, React Native, Expo Router). It is deliberately NOT part of the web workspace, so its React Native packages never mix with the website's.

- **Sign in** with the same email and password as the website (verified email required). The app keeps the refresh token in the phone's secure storage (iOS Keychain / Android Keystore), the access token in memory only. A session that the server ended (sign out everywhere, password change, removed from the company, suspended company) sends the person back to the login screen with a message.
- **Invoices**: search by invoice number or vendor, filter (needs review, unpaid, overdue, paid), pull to refresh, endless paging. Staff see only their projects' and their own invoices, exactly like the website.
- **Invoice detail**: vendor, amounts and taxes, line items, the original photo.
- **Upload**: take a photo, choose a photo, or choose a PDF, pick the project and category, upload for AI reading. Shows plain messages when the plan is paused, a page limit is reached, or the invoice looks like a duplicate.
- **Account**: who you are, switch company, plan and usage meters, contact support (the company's support address), sign out.
- **Branding**: the company's name, colours and number/date formats come from the server, so a branded app looks like the client's own.
- **Plan status**: a strip when the trial is ending or a payment is overdue. There is NO buying inside the app (app-store payment rules); it points to the website.

## 2. The client library (`src/lib/client.ts`)

No React Native code inside, so it is tested in Node against the real server (`scripts/test-client.ts`, 9 checks): sign-in, wrong password, lists, one refresh when six calls wait on an expired token, recovery from a rejected token, being signed out when the server ended the session, offline behaviour (keeps the session), logout, upload validation.

## 3. Build per company (white label)

Everything that changes per company is read from the environment when the app is built (`app.config.ts`):

| Variable | Meaning |
|---|---|
| `API_URL` | the server the app talks to (https, your domain) |
| `APP_NAME`, `APP_SLUG` | store name and internal name |
| `APP_BUNDLE_ID` | iOS bundle id and Android package, unique per branded app |
| `APP_PRIMARY_COLOR` | Android icon background |
| `APP_VERSION` | store version |

Icons and splash images in `assets/` are Expo's placeholders: replace them per brand. Branding inside the app (colours, name) comes from the server at run time.

## 4. Running it

```bash
cd apps/mobile
npm install
API_URL=http://<your computer's address>:3000 npx expo start
```

Open it in Expo Go on a phone (same Wi-Fi), or press `a` for an Android emulator / `i` for the iOS simulator (Mac only). A phone cannot reach `localhost`: use your computer's network address or a tunnel. For store builds use EAS Build (`npx eas-cli build`), which needs an Expo account, an Apple Developer account (iOS) and a Google Play account (Android).

## 5. Before store submission

Replace placeholder icons, splash and bundle ids; provide a privacy policy URL and the data-safety / privacy-nutrition answers (the app collects account email, name, uploaded invoices; no tracking); test on real devices (camera, PDF picker, poor network, expired sessions); add a test account for the store reviewers (they must be able to sign in); check the plan: apps must not sell or link to purchases for digital features, which is why billing stays on the website.

## 6. Not built yet

Offline queue for uploads taken without a signal, push notifications, biometric unlock, editing an invoice (review and approve stay on the website), a device list with remote sign-out, dark mode, tablet layouts, in-app PDF viewing, automated screen tests.
