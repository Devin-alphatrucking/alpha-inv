# Phase 10: Paywall (lock after the trial) and new modules

## 1. The paywall: data is locked until a plan is active

Status: BUILT and tested (6 database checks plus a run in the browser).

When a company's **free trial has ended**, its **plan was cancelled** and the paid period is over, a payment stayed unpaid **past the grace period**, or it has **no plan**, its data is **locked and hidden**. Nothing is deleted: everything comes back the moment a plan is active.

| Plan state | Open or locked |
|---|---|
| Free trial running | open |
| Active plan | open |
| Payment failed, inside the 7-day grace period | open (with a warning strip) |
| Cancelled, paid period not over | open |
| Trial ended, unpaid past grace, cancelled and over, no plan | **locked** |

**What a locked company sees**
- Every page redirects to **"Your data is locked"** (`/locked`). Administrators get the buy button (Razorpay) or, if payments are not switched on, a "contact support" note. Staff are told to ask their administrator.
- The side menu shrinks to: Choose a plan, Billing (admins), Support, Account. The project list and "Download all data" disappear from the header.
- **Still open:** buying a plan, support tickets, the person's own account (password, two-step, sign out, delete account, close company), and switching company.
- **Blocked everywhere else:** all pages, all actions, invoice files, uploads, the data export, and the mobile API (answers `402 PLAN_LOCKED`). The mobile app shows a "Your data is locked" screen.
- The master console is never locked: operators can still see and help a locked company.

**How it opens again:** a successful Razorpay payment, an operator extending the trial or granting a plan, or a webhook arriving. The lock state is remembered for 10 seconds per company and is cleared immediately when the plan changes.

**Where it is enforced** (so a new page cannot forget it): `pageOrg()` for pages, `requireUser()` / `requireAdmin()` / `requirePermission()` for actions and API routes, `requireMobile()` for the mobile API. The few allowed places pass `allowLocked: true`.

## 2. New modules

- **Dashboard "Needs attention"** (top of the dashboard): overdue amount and count, due in the next 7 days, invoices waiting for review, total still to pay, the five most overdue and the next due, and a payables **ageing** bar (not yet due, 1-30, 31-60, 61-90, over 90 days late, no due date). Scoped to the person's projects. Rules are unit-tested (`lib/invoices/ageing.ts`).
- **Invoice detail page** (`/invoices/{id}`): details, amounts with paid and balance, payments, line items, original file, and a **history** of who did what and when. Invoice numbers in the list open it; drafts still open the review screen.
- **Vendor statement** (`/vendors/{id}`): invoiced, paid, owed and overdue for one supplier, their ageing, and every invoice with balances. Vendor names in the list open it.
- Calendar dates (invoice, due, payment) now show the same day in every time zone (they were stored correctly but shown a day early for companies west of UTC).

## 3. Daily email digest (built)

Each morning company administrators get ONE email, only on days when something needs attention: money overdue, money due in the next 7 days, or invoices waiting for review (top five of each, with "and N more").

- **When:** from `DIGEST_HOUR` (default 8) in the company's own time zone, once a day per company. A locked company gets nothing.
- **Who:** administrators who have a confirmed email and have not turned it off. Staff never receive it. Each person can switch it off on their **Account** page.
- **How it runs:** a scheduler calls `POST /api/jobs/digest` with `Authorization: Bearer <JOBS_SECRET>` once an hour (any scheduler: your host's cron, GitHub Actions, a monitoring service). The address is closed unless `JOBS_SECRET` (16+ characters) is set. It is safe to call as often as you like: the day is claimed first, so two calls at the same moment still send one email, and if the mail server is down the day is handed back so the next hourly call delivers.
- Tested: 10 database checks (amounts, one per day, time zones, opted-out and staff excluded, no other company's data, locked company, mail server down, simultaneous runs, the scheduler address) and a run over HTTP on the demo app.

## 4. Project budgets (built)

Administrators can set an optional budget on each project (Projects, Edit; leave empty or 0 for none).

- **Spend** is the total of confirmed invoices on the project, paid or not. Drafts waiting for review are not counted until confirmed.
- **Levels:** green under 80%, amber from 80%, red at 100% and over ("₹44,933 over budget").
- **Where it shows:** a meter on the Projects list and on each project page, a "Budget alerts" card on the dashboard, a section in the daily email (a company whose only news is a budget alert still gets the email), and `budget`/`spent` on the mobile projects API.
- **Who sees it:** administrators only. Staff see no budgets, spend or alerts. Finished and paused projects raise no alerts.
- Input is checked in the form before saving (numbers only, up to 2 decimals, commas allowed) and again on the server.
- Tested: 7 database checks (spend rules, ordering, per-project limits, company separation, cents, the email) plus unit tests of the rules.

## 5. GST report (built)

Administrators open **GST report** in the menu (on a phone: More). It shows the tax on your purchases for a financial year (1 April to 31 March, last five years) or exact dates, for all projects or one.

- **Counted:** confirmed invoices by invoice date. Drafts waiting for review and invoices still being read are not.
- **Shows:** taxable value, CGST, SGST (same-state purchases), IGST (other-state), total GST; a table by month with a total row; a table by supplier with GSTIN, most tax first.
- **Worth checking before you file:** invoices with GST from a supplier that has no GSTIN saved (credit cannot be claimed), and invoices whose amounts do not add up (taxable value + GST + rounding is not the total; one rupee of slack).
- **CSV downloads** (for your accountant): by month, by supplier, and every invoice with its GSTIN. Amounts are plain numbers, the file opens correctly in Excel, and any text that starts with `=`, `+`, `-` or `@` is neutralised so a vendor name cannot run as a spreadsheet formula.
- Money is added in whole paise, so totals never drift. Administrators only (staff are turned away, and the download answers 403).
- Tested: 20+ unit checks (totals, drift, missing GSTIN, mismatches, financial-year edges, bad dates, CSV escaping) and 6 database checks (first and last day of the year, drafts left out, project filter, custom dates, company separation), plus the page and every download on the demo app.
- Not included: a rate-wise (5/12/18/28%) split, because the invoice stores tax amounts per invoice, not per rate on every bill.

## 6. Bulk upload (built)

On **Upload Invoice**, choosing or dropping two or more files opens a batch list (one file keeps the usual single flow; "One at a time" goes back).

- Pick the project and category once; they apply to the whole batch (the category can still be changed on each review).
- Up to 25 files at a time, 20 MB each. Unsupported, empty, oversized and repeated files are turned away with a reason before anything is sent.
- Files are read two at a time by the same endpoint a single upload uses, so every rule still applies per file: plan standing, the project's monthly AI page limit, same-file and same-invoice-number protection, project access. Each file shows waiting, reading, read (with a Review button), or the exact reason it failed, with Retry.
- If the plan is locked or the monthly page limit is reached, the files not yet started are not tried (shown as "Not tried" with the reason), so no time is wasted. **Stop after the current ones** ends a run early. A page left open mid-run asks before closing.
- When done, "Review the N invoices now" opens the draft list (staff: their invoices). Nothing is saved as a real invoice until someone checks it, exactly as before.
- Found and fixed while building it: two invoices from a **new** supplier read at the same moment each tried to create the supplier (a failure, or two suppliers with the same name when there is no GSTIN). Supplier lookup now runs one at a time per company. Upload failures also now show their real reason ("The AI could not read this file ... No AI pages were used.") instead of "Internal server error".
- Tested: 40+ unit checks of the queue rules (limits, repeats, two at a time, stop on page limit, cancel, retry only the waiting ones), 6 database checks of the supplier race, and real runs on the demo app against a stand-in for the AI service: successes, an unreadable file, an identical file, a file with no type, the page limit stopping the rest, and Retry. Real Azure was not used.

## 7. Rate alerts (built)

On the review screen, a line whose rate is far from what the company usually pays for the same item gets a warning under its description, and a header badge counts the high ones.

- **Usual rate:** the middle (median) rate from the company's earlier confirmed invoices for the same item description and unit (letters and punctuation ignored), the latest 20 purchases. Needs at least 3 earlier purchases; with fewer there is no warning. Drafts, the invoice being reviewed, zero and negative rates are ignored. A different unit is a different item.
- **Warnings:** 15% or more above usual (amber), 30% or more (red), 30% or more below (blue, "check the unit and quantity"). The note shows the usual rate, how many purchases it comes from, and the last rate with supplier and date.
- **Live:** judged as the rate is typed, so correcting a rate clears its warning at once.
- **Saved:** on confirm, each line stores its deviation (the existing `rateDeviationPercent` column, unused until now). Administrators see "+37% vs usual" next to lines 15% or more above usual on the invoice page.
- **Privacy:** administrators are compared against the whole company; staff only against invoices they can already see (their uploads and assigned projects), so a warning never reveals another project's prices. The stored value on the invoice page is shown to administrators only.
- Tested: 50+ unit checks (median, thresholds at the exact edges, sample window, bad numbers) and 6 database checks (same item and unit, letter case, drafts and the invoice itself left out, too little history, staff view, company separation), plus a real run on the demo app: warnings appearing and clearing as the rate was changed, and the deviation saved and shown.
- Not included: comparing against one supplier's own history, or alerts outside the review screen (for example a dashboard list of expensive purchases).

## 8. Comments on invoices (built)

Every invoice has a **Comments** card (on the invoice page and under the review form): a short thread for notes like "query raised with the vendor".

- **Who can read and write:** anyone who can see the invoice. Administrators: every invoice. Staff: their own uploads and invoices on their assigned projects. Someone who cannot see an invoice cannot read, add to, remove from, or even detect the existence of its comments.
- **Who can remove:** the author, or an administrator.
- **Rules:** up to 2000 characters; blank comments refused; control characters and invisible direction marks removed; shown as plain text (markup is never run). Ctrl+Enter posts. Slowed down after 30 comments in 10 minutes per person.
- **Trail:** adding and removing are in the invoice's history and the Activity Logs. The invoice list shows a small comment count next to the number. The admin data export has a new `invoice-comments` sheet.
- **Safety:** isolated per company by the database itself (row-level security, like every company table). If the author is removed from the company the comment stays, shown as "Former member". Deleting an invoice deletes its comments.
- Tested: 40+ unit checks (cleaning, length by characters, who may remove) and 9 database checks (author and order, refusals, staff visibility including own uploads, remove rules, hidden from others, other company, cascade and former member, activity log, flood limit), plus a run on the demo app: add (shown as plain text with a script tag typed in), count, remove, list marker.
- Not included: editing a comment after posting, @mentions and email notifications, attachments, and comments in the mobile app.

## 9. Public landing and pricing pages (built)

Customers can now find you. **`/`** is a landing page for anyone not signed in (signed-in people still go straight to their dashboard), and **`/pricing`** is open to everyone.

- **Landing page:** headline and a "Start your N-day free trial" button, how it works (upload, check, track), the twelve things the product does (every line is something it does today), the plan and price, six common questions, and a closing call to action. The header has Features, Pricing, Sign in and Start free trial. It uses the product name (`PRODUCT_NAME`), not a company's branding, and follows light and dark themes.
- **Pricing:** read live from the active plan in the database: price, per month or year, projects, team size and AI pages included. If no price is set it says "Price on request" and still leads to the trial; if there are no plans it says they are being set up. Change the price with the master console or `UPDATE "Plan" SET "priceMinor" = ...` (amount in paise).
- **Honest by construction:** the trial length is `TRIAL_DAYS`; the questions explain that after the trial data is locked (not deleted) until a plan is chosen, and that one plan covers one project. When sign-up is closed (`SIGNUP_ENABLED=false` or no email set up) no page links to sign-up and the trial wording disappears, so a button never leads to "not available".
- **Switch:** `LANDING_PAGE=off` makes `/` go to the sign-in page as before and tells search engines to stay out (for a deployment that is only one company's own app).
- **Search engines:** `/robots.txt` allows the public pages and blocks the app and API; `/sitemap.xml` lists `/` and `/pricing` using `APP_URL`. Each page has its own title and description.
- **Your legal pages and contact:** footer links to Terms and Privacy when `TERMS_URL` and `PRIVACY_URL` are set, and a Contact link when `SUPPORT_EMAIL` is set.
- Tested: 40+ unit checks (price formatting, intervals, plan wording, the switch) and runs on the demo app over HTTP and in the browser: the page content, `/pricing` with the real ₹999 plan, no horizontal scroll on a phone, landing off, sign-up closed, robots and sitemap, and `/dashboard` still protected.
- **Before launch you should:** write the real wording and legal pages (the copy here is a sound starting point, not final marketing), set the price, and add your own screenshots or logo if you want them. Nothing here claims customer numbers, reviews or app-store availability.

## 10. Master console tools (built)

Three new tools for platform operators in the master console. As with every master change, an operator needs two-step sign-in on their own account, writes a reason (3 to 300 characters), and the action is written to that company's activity log with who did it and why.

- **Set up a company by hand** (Companies, "Set up a company"): company name, country (sets currency and time zone), the administrator's name and email, and a plan: a free trial of N days, or "managed by hand" with N project plans (active, no payment). It creates the company, the administrator, starter categories and a first project, exactly as sign-up does (both now use one shared routine). The administrator is emailed a link, valid 7 days, to choose their own password, which also confirms their address; the starting password is random and known to nobody. An email that already has an account is refused, so nobody is ever attached to a company without their say. The company has not accepted the terms yet (that is left for the person).
- **Reset a person's two-step sign-in** (company page, People: "Reset two-step", shown only beside people who have it on): you tick that you checked who they are, write the reason and how you checked, and confirm. It turns off their two-step, deletes their recovery codes, signs them out everywhere (web and phone), emails them that it happened (with "if this was not you, change your password"), and logs it. Refused for your own account, for other operators, for someone without two-step, and for someone who is not in that company. The console cannot verify identity itself: that check is your team's rule, and the tick records that it was done.
- **Export a company's data** (company page, "Export this company's data"): an Excel workbook or JSON backup of everything the company could export itself (now including invoice comments), for when a company asks for a copy or is leaving. It needs a reason, only reads that one company, contains people's names and emails but no passwords, secrets or stored AI keys, and is logged. It is a form post, checked against the site's own address, so another website cannot trigger it. The administrators' own export now shares the same code.
- Tested: 11 database checks (company on a trial and managed by hand with every record, the emailed link and its use, unknown starting password, same name twice, refusals with nothing created, audit entries, the full two-step reset and its logging, every refusal, export separation and file types) plus a run in the demo console: a company created from the form and its email, a two-step reset with its email and log entry, downloads in both formats, missing reason and unknown company refused, and an anonymous request turned away.
- Not included: creating a company with an administrator who already has an account, resending the welcome email (the person can use "Forgot password"), and restoring a company from an export.

## 11. Ideas worth building next (in my order)

The planned list is finished. Things worth considering next, from what is still open:

1. **Real-world checks**: a real Razorpay test purchase, the mobile app on a phone, and a real Azure Document Intelligence run (all need your keys or devices).
2. **Production setup**: hosting, email, rotating the credentials shared during development, and replacing the client PDF generation script.
3. **Polish the public pages**: your own wording, screenshots and legal pages.
