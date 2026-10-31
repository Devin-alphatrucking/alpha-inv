# Phase 20: phone app sign-up, Google, new bottom bar, Home

## What changed

- **Website sign-in and sign-up always show our own name and logo.** A company's branding appears only after sign-in. The remembered-company cookie is gone.
- **Phone app sign-up** (`/signup` screen): the same questions and rules as the website (company, country, name, mobile number, email, password, terms), then the emailed 6-digit code, then straight in.
- **Forgot password** on the phone: code by email, then a new password.
- **Continue with Google** on the sign-in and sign-up screens. It appears only in builds that have Google client ids.
- **Bottom bar** built like the website's phone bar: Home, Invoices, a raised Upload button, one more place (Site, Purchase or Account, by role), and More (a sheet with the rest, your details and Sign out).
- **Home screen**: invoices needing review, unpaid and overdue; open and overdue site issues; purchase requests waiting; quick actions by role.

## Server routes (all under `/api/v1/auth`, no sign-in needed, rate limited)

`signup`, `confirm`, `resend`, `forgot`, `reset`, `google`. They call the same flows as the website.

## Google setup (needs your Google Cloud account)

1. In Google Cloud, create OAuth client ids for **Android** (package name + SHA-1) and **iOS** (bundle id), and a **Web** client id.
2. Build the app with `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID` set (any one is enough to show the button on that platform).
3. On the server set `GOOGLE_MOBILE_CLIENT_IDS` to the same ids, comma separated. The server only accepts a Google token whose audience is in that list.

Not tested against real Google: the server side is tested with a stand-in for Google's check; the phone side needs a real build.

## Plans and payment

Plans are chosen and paid on the website only. The app never shows prices or a buy button. On Android an administrator sees a "Plan and billing" row that opens the website; on iPhone the app only says the plan is managed on the website, because App Store rules restrict steering people to outside payment. Whether this passes review is Apple's and Google's decision; see the notes given with this phase.
