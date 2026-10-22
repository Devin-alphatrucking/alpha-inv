# Phase 6: Master console (for our own team)

Status: BUILT and tested (19 database checks plus all earlier suites, and a run on the built app). Address: `/master` on the same web app.

## 1. Who can open it

Only people flagged as platform operators. The flag is set with a command, never from a screen or sign-up:

- `npm run master -- add <email>` (the account must exist and have a verified email; the person is signed out everywhere and signs in again)
- `npm run master -- remove <email>` (takes effect at once) and `npm run master -- list`

The check runs in the database on EVERY request (not from the session token). Everyone else, including company administrators, sees a plain 404, so the console's existence is not revealed. The operator should also be an ADMIN of some company (our own), because the app signs people in to a company.

## 2. How it reads across companies without weakening isolation

Companies are still separated by Row-Level Security. The console reads other companies' data only inside a transaction that sets `app.platform = on` (`src/lib/master/db.ts`), and migration `20261026090000_platform_admin` adds policies that allow exactly this: read tickets, activity logs, error logs and projects; change ticket status. Nothing else (no invoices, no writes to projects or logs, no deletes). Company code never sets the switch. Tested: a normal connection still sees nothing of other companies, and the platform connection cannot write or delete.

## 3. Screens

- **Overview**: companies, paying plans and monthly recurring revenue, companies needing attention, open tickets, errors in 24 hours.
- **Companies**: search by name or code, filter by plan state, page through; each row opens a company.
- **Company**: plan and usage meters, billing (purchases, payments, re-check with Razorpay), people, projects, tickets, recent activity, and the changes below.
- **Billing**: payment service status, companies overdue / ending / trial ended, recent payments, the last 30 Razorpay messages with any errors, re-check all.
- **Plans**: price (in paise), currency, projects, people and AI pages per plan. Affects every company on the plan; new price applies to new purchases only.
- **Tickets**: inbox across companies (filter, search by company, subject, email or SUP number), ticket page with the message, "Reply by email" and status buttons (open, waiting, resolved).
- **Logs**: activity and errors across all companies with filters; per-company view.

## 4. Changes and the audit trail

Free or total project plans, trial extension, extra projects/people/AI pages for one company, suspend / reactivate a company (nobody can sign in while suspended; data kept; you cannot suspend a company you belong to; a closed company cannot be changed), plan editing, ticket status, billing re-check. Each needs a written reason (3 to 300 characters), is validated again on the server, and is written to the activity log against the company it touched (module MASTER: who, what, why, before and after). Viewing a company is logged too. Times in the console are UTC.

## 5. Not built yet

Two-step sign-in for operators (strongly recommended before more than one person has access), impersonating a customer to reproduce a problem, deleting or exporting a company on request, bulk actions, charts over time, alert emails (failed payments, error spikes), operator-to-customer messaging inside the app.
