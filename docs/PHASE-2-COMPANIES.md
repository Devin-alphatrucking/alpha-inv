# Phase 2 — Companies (multi-tenant) and branding

Goal: one database serving many companies, each isolated, each with its own
branding. Done in small steps; the app keeps working after every step.
Method: backup first, build, check, review, release (see ARCHITECTURE.md s.14).

## Step map

| Step | What | Behaviour change | Status |
|---|---|---|---|
| 2a | EXPAND: add `Organization`, `Membership`, nullable `organizationId` columns, backfill all existing rows into one default company | None | Built, migration tested on in-memory Postgres; NOT yet applied to a real database |
| 2b | SESSION: put `organizationId` + membership role into the sign-in token; add `requireOrg()` helper | None visible | Built (typecheck + production build pass; sign-in not exercised against a real database) |
| 2c | SCOPE: every query filters by the signed-in company; every create stamps it; vendors/categories/materials become per-company | Yes (isolation starts) | Built (typecheck, lint, production build pass; NOT yet exercised against a real database) |
| 2d | ENFORCE: per-company unique rules, `organizationId` NOT NULL, PostgreSQL Row-Level Security, cross-company test suite | Yes | Built; migration + 28-check cross-company suite pass on real PostgreSQL 18 (see below) |
| 2e | BRANDING: brand settings screen, runtime theming, remove hard-coded "Sanvicasa" | Yes | Built; 7 unit checks, 7 database checks and a 30-check end-to-end run on the real app pass |
| 2f | ONBOARDING: sign-up, invites, password reset, email verification | Yes | Built; 27 database checks, 7 unit groups and a 32-check end-to-end run on the real app pass (see below) |

Do NOT skip 2d's test suite: it is the proof that company A cannot see company B.

## 2a — what was added (schema)

New tables
- `Organization`: id, name, slug (unique), status (TRIAL|ACTIVE|PAST_DUE|SUSPENDED|CLOSED),
  country, timezone, currency, and brand fields: displayName, logoUrl,
  primaryColor, accentColor, supportEmail, supportUrl, appModel (A|B|C).
- `Membership`: user <-> organization with a role. A person can belong to
  several companies. Unique on (userId, organizationId).

New nullable column `organizationId`
- With foreign key to `Organization`: Project, Category, Material, Vendor, Invoice.
- Plain indexed column (no FK, so history/logs survive): InvoiceLineItem,
  Payment, ProjectNote, ProjectAssignment, AuditLog, ActivityLog, ApiErrorLog,
  PageUsageEvent.

Backfill (inside the same migration, safe to re-run)
1. Create the default company `org_default` ("Sanvicasa", slug `sanvicasa`, status ACTIVE).
2. Create a Membership for every existing User using the User's current role.
3. Set `organizationId = 'org_default'` on every existing row of the tables above.
4. Child rows take the parent's company (line items and payments from their invoice, etc.).

Nothing reads the new columns yet, so the running app behaves exactly as before.
Existing unique rules (global category name, vendor GSTIN, etc.) are unchanged
until 2d.

## 2b — session and helper (built)
IMPORTANT: apply the 2a migration BEFORE running this code. Sign-in now reads
`Membership`; without the table or the backfill nobody can sign in.

What changed: `auth.ts` loads the user's default company (oldest membership whose
company is TRIAL/ACTIVE/PAST_DUE; suspended/closed companies cannot sign in),
the token carries `orgId`/`orgRole`, sessions created before this step get their
company attached on next use, and `requireUser()` rejects a session with no company.
`requireOrg()` is an alias for business-data code. Picker logic is covered by
`apps/web/src/lib/org/default-membership.test.ts`.

Original plan notes:
- Sign-in token carries `orgId` and `orgRole` (default company for now; company switcher later).
- `requireOrg()` returns `{ user, orgId, role }` and every server action/route uses it
  instead of `requireUser()` for business data.
- `User.role` is kept for one release, then replaced by `Membership.role`.
- Add role OWNER to the Role enum (own migration, separate from any use of it).

## 2c — scope every query (largest step)
Rule: no business query without `organizationId`.
- Wrap the database in a company-scoped client created per request:
  `dbFor(orgId)` adds `organizationId` to every find/update/delete where and to every create.
- Files to convert (from the review): the 23 pages that query directly, 18 server
  actions, and the 5 API routes. Convert page by page; each page is checked after
  conversion.
- Lookups by id use findFirst with `{ id, organizationId }`, never findUnique by id alone.
- Reference data (categories, vendors, materials) becomes per company. The existing
  data already belongs to the default company, so nothing disappears.
- Page-limit tables: company cap moves from one global setting to a per-company
  setting (`AppSetting` key prefixed with the company id); `PageUsage.scopeKey`
  becomes `ORG:<id>` and `PROJECT:<id>`.
- Exports and the dashboard must filter by company (the export route currently
  loads everything).

## 2d — enforce
- Replace global uniques with per-company ones:
  Category (organizationId, name); Vendor (organizationId, gstin);
  Material (organizationId, categoryId, name); Invoice (organizationId, vendorId, invoiceNumber).
- `organizationId` NOT NULL on all tables above.
- PostgreSQL Row-Level Security: each request sets `app.org_id` and policies
  allow only matching rows; the application database role is not the table owner
  so it cannot bypass them. Keep the app-level filter as well (defence in depth).
- Test suite (must pass before release): two companies with overlapping names;
  for every endpoint, a user from company A gets 404/403 for company B ids;
  list endpoints never return B rows; create stamps A; export contains only A.

## 2e — branding
- Settings screen (company owner/admin): display name, logo upload, two colours,
  support email/URL.
- `GET /api/branding` returns the signed-in company's brand; the layout applies
  the colours as CSS variables and shows the logo/name in header, sign-in page
  and emails.
- Replace hard-coded strings and assets (`sanvicasa-logo.png`, page titles,
  manifest name, `public/docs/Staff_User_Guide.html`) with brand values.
- Currency/timezone read from the company, not constants.

## 2f — onboarding
- Sign-up creates company + owner + trial; invitations by email token; password
  reset; email verification; account deletion path (store requirement).

## Risks and how each step limits them
| Risk | Control |
|---|---|
| A missed query leaks data | 2c rule + 2d RLS + cross-company tests |
| Data lost in backfill | Backup first; migration is additive; verify row counts per table before/after |
| Existing users locked out | Memberships created for all users in 2a; sign-in unchanged until 2b |
| Long migration on big tables | Current tables are small; run in a quiet period and time it on a copy |

## Before running 2a on real data
1. Back up the database (and test restoring it).
2. Run the migration on a COPY first; compare row counts and check that no row has a NULL `organizationId`.
3. Then run it on production in a quiet period.


## 2c — what was built (status notes)
- `dbFor(orgId)` / `scoped(user)` / `pageOrg()` / `requireOrgDb()` (apps/web/src/lib/org): company-locked database
  handle. Unit-tested rewriting in `scoped-db.test.ts`. Run: `npx tsx apps/web/src/lib/org/scoped-db.test.ts`.
- Converted: layout, projects (+ detail, actions), vendors, categories, materials, invoices (list, upload page,
  upload route, file route, review page + actions, payment actions), payments, dashboard, users, activity/error logs,
  settings (reset now deletes ONLY this company's data), export, project-scope, AI page quota (per company).
- The unscoped export is now `rawDb`; remaining uses are limited to non-company tables (User, Membership, AppSetting,
  PageUsage), sign-in, and the activity/error loggers (audit list in the 2c report).
- Role now comes from the company Membership (User.role is kept in step until retired).
- New migration `20261022090000_page_usage_per_company` (renames the single global page counter/cap to the default company).
- Security fix included: `checkDuplicateInvoice` previously required no sign-in.
- Known limits until 2d: unique rules are still global (category name, vendor GSTIN, ...), so a second company
  cannot yet reuse a name that the first one uses; no Row-Level Security yet; nested writes are stamped by hand
  (documented in scoped-db.ts); no database-backed isolation tests yet.


## 2d — what was built (status notes)
- Migration `20261022120000_company_rules_and_rls`: fills any empty company column (safe cases only; fails and rolls back
  otherwise), per-company unique rules (Category name, Vendor GSTIN), `organizationId` NOT NULL on 11 tables
  (ActivityLog/ApiErrorLog stay nullable on purpose: failed sign-ins and unauthenticated errors have no company),
  foreign keys RESTRICT, and Row-Level Security on all 13 company tables.
- The scoped client (`apps/web/src/lib/org/scoped-db.ts`) now also runs `set_config('app.org_id', ...)` in the same
  transaction as every query. Interactive transactions go through `db.$transaction(async (tx) => ...)`; the batch form is refused.
- IMPORTANT, production setup: Postgres does not apply RLS to the table owner, superusers or BYPASSRLS roles. Create the
  ordinary role with `packages/db/prisma/rls-setup/app-role.sql`, set `DATABASE_URL` to that role, and set
  `MIGRATE_DATABASE_URL` to the owner (migrations and seeding). Admin > Settings > "Data isolation" shows whether the
  protection is really active for the connected role. Managed hosts (e.g. Neon) may give the default role BYPASSRLS: use a separate role.
- Run the suite: `TEST_ADMIN_DATABASE_URL=<server admin url> npm run test:isolation` (works with `npm run db:up`'s Docker Postgres).
  It creates a throwaway database, applies every migration, connects as `app_runtime`, runs 28 checks, drops the database.
  `ISOLATION_APP_AS_OWNER=1` is a self-check that must make the 5 database-layer checks FAIL.
- Known gaps: references between rows (e.g. an invoice's vendor) are not enforced to be the same company by the database
  (the scoped client + RLS prevent obtaining another company's ids, but there are no composite foreign keys);
  platform/master-admin cross-company access is not designed yet (needs its own BYPASSRLS role or policy);
  the seed script and migrations must run as the owner.


## 2e — what was built (status notes)
- Branding per company (Admin > Settings > "Branding and region"): display name, logo (PNG/JPEG/WebP up to 300 KB, stored
  in the database, SVG refused, type checked by file contents), main and accent colours, support email/site, country,
  currency, timezone. Only a company ADMIN can change their own company.
- Runtime theming: strict `#RRGGBB` colours become CSS variables (`--primary`, `--ring`, sidebar, chart colours) with automatic
  black/white text for readability and a lightened variant in dark mode. Page title, tab name and header come from the company.
- Sign-in page: neutral product look by default; `/login?c=<company code>` shows that company's name, logo, colour and support
  contacts (also on the very first visit). After sign-in the company's own brand always applies.
- Endpoints for web and mobile: `GET /api/branding` (signed in), `GET /api/branding/public?c=<code>` (no company id),
  `GET /api/branding/logo/<code>` (public, served with nosniff + sandbox). API paths now answer a signed-out caller with a JSON 401.
- Money and dates use the company's currency, locale (from country) and timezone everywhere (server pages, client components,
  error messages); the monthly AI-page period follows the company timezone.
- Removed hard-coded "Sanvicasa": header, sign-in, metadata, manifest (now neutral `PRODUCT_NAME`), export file names,
  reset phrase (now "RESET DATA"), project cookie (`project-scope`), seed data, README/package text, icons (neutral
  placeholders, replace with real product art) and the staff guide. The old Sanvicasa logo/icons/guide are kept in
  `docs/legacy-assets/sanvicasa/`.
- To keep the existing company's look: `npm run brand:logo -- sanvicasa docs/legacy-assets/sanvicasa/sanvicasa-logo.png`,
  then set its display name and colours in Settings.
- Migration changes: `20261022150000_organization_logo` (new table). Migration 2a now creates the default company
  ("Sanvicasa") ONLY when there is existing data to migrate, so a fresh install starts empty and the seed script creates the
  first company from `SEED_COMPANY_NAME` / `SEED_COMPANY_SLUG`.
- Known limits: the PWA manifest and favicon are not per company (browsers fetch them without cookies); company slug and
  legal name cannot be edited in the UI yet; no custom domains yet; a logo is stored as-is (no resizing).


## 2f — what was built (status notes)
- **Sign-up** (`/signup`): company name, your name, email, password, country (sets currency and timezone), agreement. Creates the company
  (TRIAL), its first admin, 8 starter categories and "My first project", then emails a confirmation link. Same answer whether or not the
  address already exists (an existing account gets an "already have an account" email). Needs email configured; `SIGNUP_ENABLED=false` turns it off.
- **Email confirmation**: required before sign-in for self-service accounts. The link opens a page with a button (so email scanners cannot use it
  up). Existing users were marked confirmed by the migration; users created by an administrator or the seed script count as confirmed.
- **Password reset** (`/forgot-password`, `/reset-password`): 1-hour single-use link, neutral answers, new password follows the rule, every
  existing session is ended, an email notice is sent.
- **Invitations** (Users page): admin chooses email, role and (for staff) projects; the invitee sets their own password. Someone who already has an
  account must be signed in as that account; they then belong to two companies. Open invitations can be cancelled; links last 7 days, single use.
- **Account page** (`/account`): change password, sign out of all devices, company switcher (only if you belong to several), delete my account,
  close company (admins). Deleting erases name/email/password and removes memberships; records the person created stay, shown as "Deleted user".
  The only administrator of a company cannot delete their account until another administrator exists or the company is closed.
  Closing a company signs everyone out and blocks sign-in; the data is kept until deleted under YOUR retention policy (no automatic purge job yet).
- **Password rule** (10+ characters, not common, not containing your email, max 72 bytes) is used everywhere a password is set. bcrypt cost 12.
- **Sign-in protections**: limits per email (10 per 15 min) and per network address (40 per 15 min), shared across servers through the database;
  unknown address and wrong password look and time the same; "email not confirmed" is only revealed after a correct password.
- **Revocable sessions**: sessions are re-checked against the database every minute (`SESSION_RECHECK_MS`, default 60000). Signing out
  everywhere, a password change, deleting the account, removal from a company, a role change or closing the company take effect within a minute.
- **Email**: `EMAIL_TRANSPORT` = smtp (set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) | file (development: `.data/outbox.jsonl`) | none.
  `APP_URL` (or `AUTH_URL`) must be set in production: links in emails are built from it, never from the request. `TERMS_URL` / `PRIVACY_URL` (https) are linked on sign-up.
- Migration `20261023090000_account_security` (User fields, AuthToken, RateLimit). New dependency: nodemailer.
- Tests: `npm run test:unit`; `TEST_ADMIN_DATABASE_URL=... npm run test:isolation` now runs two database suites (isolation + account flows).
- Known limits: the company switcher server action and the real SMTP delivery are not covered by automated tests (SMTP is only exercised with the
  file transport); sign-in cannot be limited by IP unless the proxy in front of the app sets X-Forwarded-For; no two-factor sign-in yet; no
  "remember this device"; legal pages (terms, privacy) must be provided by you; invitations and verification need a working email provider.
