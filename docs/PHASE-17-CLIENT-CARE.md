# Phase 17: client care in the master console (17a console, 17b trial emails)

Our team can now see where every company is on the way from sign-up to paying, what needs attention, and keep notes
and follow-up reminders. Part 17b (bottom of this page) adds the automatic trial emails.

## The funnel

| Stage | Meaning |
| --- | --- |
| Signed up | On trial or no plan, no project yet |
| Set up | Has a project, no activity in the last 7 days |
| Using it | Has a project and some activity in the last 7 days |
| Paying | On a paid plan (including overdue and ending-soon) |
| Lost | Cancelled, or the trial ended without a plan |

"Activity" is the company's own activity log (sign-ins, invoices, site work and so on). Our operators' visits (module
MASTER) never count. Rules live in `lib/master/health.ts` (pure, tested in `health.test.ts`).

## What needs attention

Each company gets a level (Healthy / Watch / At risk) with the reasons in words:

- At risk: payment overdue (grace or past grace), trial ends in 3 days or less, trial ended without a plan.
- Watch: no project 3 days after sign-up, set up but quiet for 7 days (trial), paying but quiet for 14 days, plan ends
  at period end, suspended, open support tickets.

## Where it shows

- **Overview**: client funnel (each stage links to the filtered list), trials ending within 7 days, next follow-ups,
  and "Needs attention" now counts every at-risk company.
- **Companies**: Stage and Last active columns, a Stage filter and "Needs attention only".
- **Company page**: a Client care card with stage, health reasons, follow-ups (add, done, open again) and notes.
- **Follow-ups** (new tab): everything not done, soonest first with Overdue / Today / Soon badges, and what was done
  recently.

## Notes and follow-ups

- A note is up to 2000 characters, kept with the author's email and time. Follow-ups are a task (200 characters) and a
  date from today to a year ahead. Dates are calendar days in UTC, like the rest of the console.
- Every note and follow-up change is written to the audit log against the company (`MASTER_ADDED_NOTE`,
  `MASTER_ADDED_FOLLOWUP`, `MASTER_DONE_FOLLOWUP`).
- Tables `ClientNote` and `ClientFollowUp` (migration `20261110090000_client_care`) are platform-only: row-level
  security opens only when `app.platform = on`, so a company's connection reads and writes nothing there, even if code
  were to reach for them.

## Tests

- `src/lib/master/health.test.ts`: stages, every attention rule and its wording, dates and text cleaning.
- `tests/client-care.test.ts` (part of `npm run test:isolation`): funnel and health from real rows, operator visits not
  counted, filters, overview counts, notes and follow-ups (valid, refused, done/reopened, pressed twice), audit entries,
  and that a company connection cannot read or write them.

## 17b: trial emails

Administrators of a company on a trial get two emails, from the platform's mail settings, in the company's own name and colour:

- **Trial ending**: once, when 3 days or less are left ("your trial ends in 3 days"), with a Choose a plan button.
- **Trial ended**: once, after it ends without a plan. Only for trials that ended in the last 7 days, so switching this on
  never writes to long-gone trials.

Both say nothing is deleted. Who gets them: verified, undeleted administrators (not staff, not unverified). Not sent for
paying, suspended or closed companies.

- A scheduler calls `POST /api/jobs/trial-notices` every hour with `Authorization: Bearer <JOBS_SECRET>`, the same pass as the
  daily digest (`lib/jobs-auth.ts`). Closed unless `JOBS_SECRET` (16+ characters) is set.
- Once per trial: the notice is claimed in the database before it is sent (columns `trialEndingNoticeAt`,
  `trialEndedNoticeAt`), so overlapping runs send one email. If nobody could be told or the mail server is down, the claim
  is handed back and the next hourly run tries again.
- **Extending a trial** in the master console clears both marks, so the new end date is announced again.
- The company page shows when each email was sent.
- Rules: `lib/plans/trial-notice.ts` (tested in `trial-notice.test.ts`); sending: `lib/flows/trial-notices.ts`
  (`tests/trial-notices.test.ts`: recipients, once only, five at once, ended after ending, extension starts again).

## Not done yet

- Revenue history and a "check-in" email for quiet companies, if wanted.
- The new console pages were type-checked and linted but not looked at in a browser (needs an operator sign-in with two-step).
- The hourly call must be set up on the host (it does nothing until a scheduler calls it).
