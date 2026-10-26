# Sign in and sign up with Google

A **Sign in with Google** button on the sign-in page and a **Sign up with Google** button on the sign-up page. They appear only when the site has Google credentials; without them nothing changes.

## Turning it on (you do this once)
1. In Google Cloud Console: APIs & Services > Credentials > Create credentials > OAuth client ID > Web application. (First time: set up the OAuth consent screen with the app name, support email and your terms and privacy links.)
2. Authorised redirect URI: `<your site address>/api/auth/callback/google` (for local testing `http://localhost:3000/api/auth/callback/google`). The site address must be the same as `AUTH_URL`.
3. Put the two values in the server settings: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart. The buttons appear.
4. Keep the secret out of git. Rotate it in Google Cloud if it ever leaks.

## What happens
- **New person:** an account is created with the confirmed Google email, a company named "<first name>'s company" (they can rename it), a 14-day free trial, and they become its administrator. Continuing counts as accepting the terms (the page says so). No emailed code is needed because Google already proved the address.
- **Existing person:** matched by email address (any letter case) and signed in to the account they already have. If they had not confirmed their email yet, Google confirms it.
- The session is built from our own records (company, role), never from what Google sends.

## What it will not do
- Accept an email Google has not confirmed.
- **Skip two-step sign-in.** Someone who turned it on is told to use their password and authenticator code. Google cannot be a way around it.
- Revive a deleted account, or enter a suspended or closed company.
- Create a second company for someone who already has an account.
- Give the Google-created account a password anyone knows. It gets a random one; the person can set their own with "Forgot your password?" if they also want email sign-in.

Failures send the person back to the sign-in page with a plain message that does not say whether an account exists.

## Under the hood
`src/lib/flows/google.ts` (rules, tested by `tests/google.test.ts`, 8 checks), the provider and callbacks in `src/lib/auth.ts`, the button in `src/components/google-button.tsx`. Sign-up through Google is limited to 60 new accounts an hour for the whole site.

## Not covered by the automatic tests
The round trip to Google itself needs real credentials. I checked that the button starts the Google sign-in with the right redirect address and PKCE, but a real sign-in has to be tried once with your credentials.
