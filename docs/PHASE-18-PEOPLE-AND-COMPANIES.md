# Phase 18: mobile numbers, helping a colleague with a password, one person in several companies

## Mobile number
- **Sign-up** now asks for a mobile number (required). **Accepting an invitation** as a new person asks for one too. A person who
  already has an account and accepts another invitation keeps the number they have.
- Typed any normal way (`98765 43210`, `+91 98765 43210`, `098765-43210`) and stored one way: international form
  (`+919876543210`). A number without a `+` is read as a number of the company's country (India, Australia, UK, US and so on);
  a number with its own `+` is taken as typed. An Indian number must be 10 digits starting 6 to 9. Rules: `lib/security/phone.ts`.
- **My account** has a Mobile number card (add or change; people who signed up with Google add theirs here). Administrators can
  type one when adding a person, and the Users list shows it. The master console's company page shows it too.
- Not verified by SMS (there is no SMS service); it is a contact detail, not a sign-in factor.

## An administrator helping a colleague with a password
On **Settings > Team and roles**, each person has a **Password** button:
- **Send reset link** (recommended, always available): the person gets the usual link and 6-digit code in their own inbox and
  chooses their own password. The administrator never sees it. Works for people who belong to several companies too.
- **Set a new password now**: the administrator types one and tells the person. Safeguards: the administrator first confirms
  with an emailed code (same as removing a person); only for people who belong to **this company alone** (a password is one per
  person, so changing it would reach into their other companies); never for yourself (use My account) or for our own platform
  operators; the new password must pass the same strength rules; the person is signed out of every device (web and phone) and
  emailed that it was changed (the email never contains the password); written to the activity log.
- The old "password" box in the Edit dialog is gone: it had none of these safeguards. Edit still changes name, email, mobile
  number, role and projects (name, email and number only for people who belong to this company alone).

## One person, several companies
This already worked and is now easier to find:
- A person has **one sign-in** and can belong to many companies. An employee of company A can **start a company of their own**
  (own 14-day trial, own people and data, they are its administrator; up to 5 companies they run, 3 new a day). Company A cannot
  see it and it cannot see A.
- The **company menu** in the top bar is now shown to everyone (it used to appear only after joining a second company). It lists
  your companies, switches between them, and has "Start a company of your own". The sign-up page says the same for people who
  already work elsewhere.
- Someone invited by a second company joins it with the account they have (they sign in, then accept); they keep the first.
  Adding a person whose email already has an account now points the administrator to **Invite someone** instead of failing.
- **Working in two companies**: one company is active at a time (switch from the company menu, the page reloads into the other).
  The same sign-in is used in both, so changing the active company changes it in every tab of that browser. The phone app has
  the same switch. Data of the two companies is never mixed.

## Tests
`src/lib/security/phone.test.ts` (number rules) and `tests/people-phone.test.ts` (7 database checks: sign-up refusals and saved
form, Australian/UK numbers, invitation with and without a number, own-number change, setting a password with sessions ended and
mail without the password, every refusal, reset links including for a two-company person).

## Not checked by tests
The new Users dialog and company menu were type-checked and linted but not clicked through in a browser.
