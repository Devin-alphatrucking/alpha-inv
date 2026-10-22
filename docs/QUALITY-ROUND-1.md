# Quality round 1: bugs found and fixed

Method: lint and type checks, a walk through every screen in the browser, then three independent read-only code reviews (invoice lifecycle; admin and data pages; accounts, payments, mobile API and master console). Every finding was checked against the code before fixing. Each fix is covered by a test where the code can be reached without a signed-in browser session.

## Security

| Finding | Fix |
|---|---|
| Someone holding an old cookie could revive a session that "sign out everywhere" or a password change had just ended (the browser can post session updates) | The session refresh now needs a proof only server code can create (`serverUpdateProof`) |
| Sign-in link could send the person to another site (`callbackUrl`, including `javascript:`) | Only paths inside the app are accepted (`lib/security/redirect.ts`, tested) |
| Closing a company left its Razorpay plans charging for up to 10 years | Closing cancels the plans first; any that cannot be cancelled are recorded in the activity log for an operator (tested, including the failure case) |
| Rate limits could be bypassed by sending a fake `X-Forwarded-For` | The address is now counted from the END of the list (`TRUSTED_PROXY_HOPS`, default 1) and Cloudflare's header wins (tested) |
| Export contained the encrypted Azure key of every project | Exports use explicit column lists only; Excel cells are capped so the file opens cleanly; non-admins get a clean 403 |
| Unexpected errors returned database and file details to the caller | Callers get a generic message; the real text goes to the admin error log only |
| Timing differences revealed which email addresses have accounts | Sign-up, "send link" and reset now take the same time whether or not the address exists |
| Mobile refresh-token reuse grace counted from the last request, not the last rotation | New `refreshedAt` column (migration `20261028090000`) |
| `null` request bodies and concurrent invite sign-ups caused 500 errors | Guarded; the second sign-up gets a clear message |
| Changing a plan's currency left a stale Razorpay plan | The cached provider plan is reset |

## Money and invoices

| Finding | Fix |
|---|---|
| Two simultaneous payments could together exceed the invoice total, or leave the status "partially paid" when it was paid | Payments run under a lock on the invoice and recompute from the real total (`lib/invoices/payments.ts`; 8 parallel payments tested: exactly one accepted) |
| OVERDUE was almost never set, and "due today" counted as overdue in some zones | One rule in `lib/invoices/status.ts` (whole due day passed in the company's time zone; part-paid and past due is OVERDUE) plus a throttled sweep on page loads and the mobile API (tested, including time zones) |
| Cents arithmetic in floating point | Comparisons in whole paise |
| Fully-paid date came from the last payment entered, not the latest payment date | Uses the latest payment date |
| Confirming a review twice (two tabs) doubled the line items | The invoice is locked during confirmation |
| Staff could rename a vendor, or clear its GSTIN, for the whole company while confirming their own invoice | Only people who may manage vendors change an existing vendor |
| Credit notes and invoices with no item lines could not be confirmed | Validation accepts negative amounts and empty item lists |
| A failed upload after AI reading left the stored file behind | The file is removed (the AI pages stay counted) |
| Staff could delete invoices that have payments recorded, bypassing "only admins delete payments" | Refused with a clear message |
| Payments page totals were wrong beyond 200 payments and used the server's month | Totals come from the database, month starts in the company's time zone |
| Invoice list showed only 100 invoices, sorted by status, and crashed on a bad `?status=` | Paged (50 per page), newest first, bad filters ignored |
| Payment dialog kept an old balance after a partial payment | Resets each time it opens; modes are friendly names |

## Admin and data pages

- A company could be left with no administrator: demoting the last one is refused.
- Deleting a project that has invoices crashed the page after showing the toast: the dialog now stays open with the reason.
- Dashboard "Pending" was wrong when a date filter was set; months were bucketed by server time; date presets used the browser's zone. All now use the company's time zone and all payments for what is owed.
- Edit and Delete on the mobile project card also opened the project: moved outside the link.
- Duplicate vendor or category names crashed the page: forms now show a message (`ActionForm`).
- Project list and project page disagreed on "Pending": one rule everywhere.
- Reset data: password attempts are limited, open invitations are cancelled, and an entry records who did it.
- Page numbers in the logs are validated; the dashboard page no longer declares itself a server action.
- Layout: header no longer overlaps at medium widths, the dashboard cards no longer cut figures, tables hide low-priority columns on narrower screens.
- Lint: 0 errors, 0 warnings.

## Known and deliberately not changed

- Someone can pre-register an account for another person's email with their own password (the real owner must click the confirmation link and the account would then be shared). Mitigated by password reset; fixing it properly means delaying account creation until the email is confirmed.
- Operators have no second sign-in factor yet (recommended before a second person gets access).
- A confirmed invoice's stored totals are taken from the review form (not re-added from the line items) because additional taxes and charges are entered separately.
- Rate sheet averages include unconfirmed invoices and are not quantity-weighted.

## Tests

154 database checks (35 isolation, 27 account flows, 20 plans, 27 billing, 19 master console, 15 mobile, 11 payments/overdue), unit tests for rules, tokens, redirects, client IP and invoice status, and 9 mobile-client checks against the real server.
