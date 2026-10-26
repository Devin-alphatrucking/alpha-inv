# Phase 11b: One-time codes (OTP) by email

Status: BUILT and tested (rules unit-tested, 14 database checks, all earlier suites updated and passing, and a run in the browser: sign-up, wrong then right code, password reset by code, and the "confirm it is you" box). Email only; SMS is not included.

## What a code is
Six digits, sent to the person's email. It works for **10 minutes**, allows **5 tries** and works **once**. Asking for a new code cancels the older one, and a new one cannot be asked for within **30 seconds**. Only a keyed hash of the code is stored (not the code), tied to the code's own id, its purpose and the address, so a copied database row cannot be guessed offline without the server's secret. Wrong tries are counted atomically, so many guesses in parallel still stop at five.

## Where it is used
| Where | What the person sees |
|---|---|
| **Sign-up** | After sending the form, a box asks for the 6-digit code. The same email also has the old confirm link, which still works. A "Send a new code" button waits 30 seconds. |
| **Confirm page** (`/verify-email`) | Enter your email, get a new code, type it. |
| **Forgot password** | After asking, one screen takes the code and the new password together. The password is checked first, so a weak one does not use up a try. The email also has the old reset link. Resetting ends every session and emails a "password changed" notice. |
| **"Confirm it is you"** before a risky action | A small box opens, a code is emailed, the person types it and the action runs. One confirmed code covers every risky action for the next **15 minutes** (so a pay run followed by another needs one code). The actions: **remove a person from the company**, **close the company**, **delete your account**, **record a payment run**. Deleting the account and closing the company still need the password and the typed word as well. |

Not changed: joining by invitation still uses its emailed link (the link itself proves the inbox), sign-in with an authenticator app (two-step) is separate, and the phone app has no new screens (it does not do any of the risky actions).

## Safe by design
- The answer never says whether an address has an account (a code request or a wrong code looks the same either way).
- Limits: 40 code tries an hour per network address and 20 per address; 8 "confirm it is you" codes an hour per person.
- If email is not set up on a server, the extra step cannot be offered, so the risky actions go ahead as before (the password and typed-word checks stay).
- The risky actions were turned into actions that return a result (they used to throw), so the screen can ask for the code and the direct request cannot skip it.

## Changes you might notice
- Sign-up and reset emails now lead with the code (subject: "Confirm your email: your ... code is 123 456"), with the link below.
- A second confirmation or reset email to the same address within 30 seconds is not sent (and nothing different is said).

## Not included
- SMS or WhatsApp codes (needs a provider and, in India, registered message templates).
- Asking for a code at every sign-in from a new device.
