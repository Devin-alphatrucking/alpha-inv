# Phase 9: Two-step sign-in (authenticator app)

Status: BUILT and tested (11 database checks, RFC 6238 test-value unit tests, and a full run in the browser: set up, sign out, password, code prompt, recovery code, signed in).

## What it is

Anyone can turn it on from **Account > Two-step sign-in**. Signing in then needs the password AND a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password and similar). It works on the website and in the mobile app (the app shows a code box after the password is accepted).

**Master console operators must use it**: until it is on, `/master` shows "Turn on two-step sign-in first" and every master action is refused. Turning it off later locks the console again.

## How it works

- **Setup**: a secret is created and stored encrypted (AES-256-GCM, the same `APP_ENCRYPTION_KEY` as the Azure keys). It counts only after the person types a correct code from their app. The QR picture is drawn on our server, so the secret never goes to a third-party service.
- **Recovery codes**: 8 single-use codes shown once when it is turned on; only their hashes are stored. They work like an app code at sign-in, are used up, and are logged. The Account page shows how many are left and can make new ones (which cancels the old ones).
- **Each code works once** (the last accepted 30-second step is remembered); two sign-ins presenting the same code at the same moment: only one succeeds. A code from the previous or next 30 seconds is accepted (clock drift).
- **Guessing is limited**: 10 wrong codes per person per 15 minutes, on top of the password limits.
- **The code is only asked for after the password is right**, so a wrong password never reveals that an address has two-step on.
- **Turning it off or making new recovery codes** needs the password AND a current code (or a recovery code): a stolen session alone cannot remove the protection.
- Everything is written to the activity log: `TWO_STEP_ENABLED`, `TWO_STEP_DISABLED`, `RECOVERY_CODES_RESET`, `RECOVERY_CODE_USED`.

## Mobile API

`POST /api/v1/auth/login` accepts an extra `totp` field (an app code or a recovery code). With two-step on and no code: `401 totp_required`; wrong or reused code: `401 totp_invalid`; too many tries: `429 rate_limited`.

## If someone loses their phone and their recovery codes

There is no self-service path by design (that would defeat the protection). An operator with database access can clear it for that person: set `totpSecretEnc`, `totpEnabledAt` and `totpLastStep` to NULL on the user and delete their `RecoveryCode` rows. Verify the person's identity first. A master-console button for this (with an audit entry) is a sensible next step.

## Not built yet

Requiring it for all company administrators (a per-company setting), "remember this device for 30 days", passkeys / security keys, and a master-console button to reset a customer's two-step after an identity check.
