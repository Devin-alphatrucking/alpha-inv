# Phase 4: Plans, limits and support (priority from now on)

Status: PLANS, LIMITS AND SUPPORT ARE BUILT (section 9). The Razorpay payment step is BUILT too: see `docs/PHASE-5-PAYMENTS.md`. Without Razorpay keys the
app works as before: an operator sets what a company has bought with `npm run plan -- set ...`.

## 1. The model, as you described it

- **One plan = one project.** A company starts with a plan that includes **one project**.
- **More projects = buy the plan again.** A company that wants a second project buys another plan (one per extra project).
- **User limit.** Each plan has a limit on how many users (employees) can use it.
- **Support.** Customers raise a ticket by **email**; your team answers.

## 2. How it maps onto what exists

| Need | Already in the code | Still to build |
|---|---|---|
| A company | `Organization` (status TRIAL / ACTIVE / PAST_DUE / SUSPENDED / CLOSED) | none |
| Projects | `Project` (per company) | a limit on how many a company may have |
| AI pages per project | `Project.monthlyPageLimit` (default 500) and the company cap | default taken from the plan |
| Users | `Membership`, invitations, admin-created users | a limit on how many members (plus open invitations) |
| Plan, price, subscription | nothing | `Plan`, `Subscription` tables, billing provider, webhooks |
| Support | contact email on the company's branding | support page and ticket log |

## 3. Proposed data model

```
Plan          code, name, priceMinor, currency, interval (MONTH|YEAR),
              includedProjects (1), userLimit, aiPagesPerProject (500), active
Subscription  organizationId, planId, quantity,        -- quantity = how many project plans were bought
              status (TRIALING|ACTIVE|PAST_DUE|CANCELED),
              trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd,
              provider, providerCustomerId, providerSubscriptionId
BillingEvent  provider, eventId UNIQUE, type, payload, processedAt   -- webhook inbox (safe to replay)
SupportTicket organizationId, userId, number (SUP-0001...), subject, body, status, priority, createdAt, resolvedAt
```

Why `quantity`: "buy the plan again" is exactly a quantity on the same subscription in Razorpay and Stripe. One invoice,
one renewal date, and the provider handles proration when someone adds or removes a project.

## 4. The limits (what the code must check)

Computed in ONE place, `getEntitlements(orgId)`, so the web app, the API and the mobile app all agree:

- **Projects allowed** = `quantity x plan.includedProjects`. Checked when creating a project and when un-archiving one.
- **Users allowed** = see open question 1. Checked when an administrator creates a user, sends an invitation and when an
  invitation is accepted (open invitations count, so two invitations cannot both fit into one remaining seat).
- **AI pages**: each project gets `plan.aiPagesPerProject` per month (today 500); the company cap becomes
  `projects x pages` unless set lower.
- Trial: a company created through sign-up starts TRIALING with the same limits as one plan (one project).

What the person sees: usage meters ("Projects 1 of 1", "Users 4 of 5", "AI pages 120 of 500"), a clear message when a limit
is hit, and a **Buy another project** button (web only: see the app-store note in the client document).

## 5. Life cycle rules (proposed defaults)

| Situation | What happens |
|---|---|
| Payment fails | PAST_DUE with a grace period (for example 7 days), then read-only. Data is never deleted for non-payment. |
| Cancelled | Access until the end of the paid period, then read-only for 30 days, then closed. |
| Quantity reduced below projects in use | Not allowed until the extra projects are archived; archived projects do not count. |
| Plan changes | Handled by the payment provider (proration). Limits update from the provider's signed webhook, never from the browser. |
| Your team overrides | Master admin can raise limits or extend a trial with a reason, recorded in the audit log. |

## 6. Support tickets by email

Today: customers email you. Proposed, in this order and each step useful on its own:

1. **Help and support page** in the app showing your support address (`SUPPORT_EMAIL`) and an **Email support** button that opens the
   customer's mail program with the details you always need already filled in: company name and code, their name and
   email, plan, app version, and the last error reference. Fewer back-and-forth questions.
2. **Ticket log**: when someone uses the form instead, the app emails you AND stores a `SupportTicket` with a reference number, and emails
   the customer a confirmation with that number. Status (open / waiting / resolved) is changed by your team.
3. **Replies stay in email** (no inbox to build). Optionally forward replies into the ticket later.
4. **Priority by plan** (for example one business day for paid plans) shown to the customer; limits on how many tickets per day to stop abuse.
5. The master admin console lists tickets with the company's plan and usage next to each one.

## 7. Open questions (answers change the numbers, not the design)

1. **Is the user limit per company or per project plan?** (Example: 5 users per plan, so 2 projects = 10 users? Or 5 users in total?)
   Recommended: per plan, multiplied by quantity, so adding a project also adds seats.
2. **Which users count?** Everyone with a membership, or only staff (employees)? Do administrators count?
3. **Price** per project and billing period (monthly, yearly, or both); currency per country?
4. Is there a **free trial**, how long, and is the first project free?
5. Can a company **move a plan to a different project** (archive one, activate another) in the same period?
6. **Support promise**: response time per plan, hours, and which language?
7. Payment provider: **Razorpay** (India) or **Stripe** (international), or both by country.

## 8. Build order

1. Tables, a default plan, `getEntitlements`, and the checks on projects and users (works with no payment provider: you set the plan by hand).
2. "Plan and usage" screen for customers; upgrade message when a limit is hit.
3. Support page and ticket log (can ship before payments).
4. Payment provider: checkout, quantity changes, signed webhooks, `BillingEvent` inbox, grace period and read-only mode.
5. Master admin: plans, subscriptions, tickets, overrides.
6. Mobile apps read the same entitlements from the API.


## 9. What was built (and how to use it)

Defaults used (you chose them): the user limit is **per plan, multiplied by the number of project plans bought**. Plan PROJECT = 1 project, **5 users**
(a placeholder number: change it), **500 AI pages per project per month**. Price is not set yet.

**Tables and migration** `20261024090000_plans_and_support`: `Plan`, `Subscription` (quantity = project plans bought), `SupportTicket` (protected by
Row-Level Security like the other company tables). The migration creates the default plan and gives every EXISTING company an ACTIVE subscription
sized to what it already uses (its active projects, or its members divided by 5, at least 1), so nobody is locked out. A fresh install gets the plan and no company.

**Rules** (`src/lib/plans/rules.ts`, pure and unit-tested; `entitlements.ts` reads the database):
- Allowed projects = quantity x 1; allowed people = quantity x 5; AI pages per project = plan value. Operator overrides: extra projects, extra users, AI pages.
- Counted: ACTIVE projects (completed and archived free their place), company members who have not deleted their account, and open invitations.
- States: trial, active, payment overdue (grace period keeps everything working, then paused), cancelling (works until the period ends), ended trial, cancelled, no plan.
  When the plan is not in good standing, adding projects, people, invitations and uploading invoices is refused with a plain message. Viewing, editing existing data and support always work.
- A company admin can lower a project's AI page limit but never above the plan; the company-wide cap cannot exceed projects x pages.

**Enforced in**: creating or re-activating a project (race-safe: the company is locked, so two requests cannot take the last place), admin-created users,
sending an invitation, accepting an invitation (checked again with the company locked; a refusal does not use up the link), uploading invoices, the AI page limits.
Sign-up starts a trial of one plan (`TRIAL_DAYS`, default 14).

**Screens**: *Plan & usage* (admins): plan, status, trial/period dates, meters for projects, people and AI pages (company and per project), and "Ask to add a project plan".
A status strip appears at the top when the plan needs attention (trial days left, overdue payment, ended plan). Projects and Users pages show "x of y" and disable the button with the reason.

**Support**: a *Support* page for everyone. The request form saves a ticket (reference SUP-000123), emails your inbox (`SUPPORT_EMAIL`) with company, plan, state and usage
included and the customer as reply-to, and emails the customer a confirmation with the reference. Paid plans get priority HIGH. A prefilled "Email support" link is also offered.
Customers see their tickets (administrators see the company's); limits: 5 requests per person per hour. Replies stay in email.

**Operator commands** (until the admin console exists):
- `npm run plan -- list` | `show <company>` | `set <company> --quantity 2 --status ACTIVE --reason "..."` (also `--trial-days`, `--grace-days`, `--period-end YYYY-MM-DD`, `--extra-projects`, `--extra-users`, `--ai-pages`)
- `npm run plan -- edit-plan PROJECT --price 99900 --currency INR --users 5 --pages 500` (changing a plan changes every company on it)
- `npm run ticket -- list [--status OPEN]` | `show <number>` | `status <number> WAITING|RESOLVED|OPEN`

**Tested**: 20 database checks (including 8 simultaneous requests for the last project place and 8 for the last 2 seats, states, grace periods, the operator commands,
tickets and their isolation), migration backfill on a legacy database, pure rule tests, and a 22-check run on the real app. Previous suites still pass.

**Not built yet**: payment provider and webhooks; automatic trial-end/grace/cancel transitions from payment events (today an operator changes status);
price shown to customers; admin console; moving a plan between projects; inbound email into tickets; SLA timers.
Note for operators: timestamps are stored in UTC; raw SQL that compares them must use `(now() AT TIME ZONE 'UTC')` (a test caught this).
