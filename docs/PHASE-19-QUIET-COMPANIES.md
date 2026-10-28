# Phase 19: check-in email for quiet companies

A company (trial or paid) where nobody has done anything for 14 days gets one friendly email to its verified administrators: data is safe, reply if you need help, button to open it again. Rules in `lib/plans/quiet-notice.ts`:
- quiet = 14 to 90 days since the last activity (`Organization.lastActiveAt`; never-active companies count from sign-up); older than 90 days is treated as gone;
- only TRIAL and ACTIVE companies (not suspended or closed);
- at most once every 30 days (`Organization.quietNoticeAt`, migration `20261114090000_quiet_notice`).

The job is `POST /api/jobs/quiet-notices` (same `JOBS_SECRET` as the others, call it hourly). The notice is claimed in the database before sending, so two runs at once send one email, and a company with nobody to write to is not marked.

Tests: `quiet-notice.test.ts` (rules) and `tests/quiet-notices.test.ts` (6 database checks).
