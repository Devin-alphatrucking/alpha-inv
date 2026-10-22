# Target Architecture — Sanvicasa Invoice & Billing (SaaS)

Status: PROPOSAL. No application code has been changed. Review, adjust, then implement phase by phase.

Goals: multi-tenant subscription product, fast and smooth, one backend for
tenant web + mobile + master admin, safe to change and easy to operate.

---------------------------------------------------------------------------
## 1. Surfaces (who uses what)

| Surface | Users | Domain (example) | Stack |
|---|---|---|---|
| Tenant web app | Customer owners, admins, staff | app.example.com | Next.js (UI only) |
| Mobile app | Customer staff / admins | store apps | Expo (React Native) |
| **Master Admin console** | **Your team only** | admin.example.com | Separate Next.js app |
| Public API | All of the above | api.example.com | Fastify or NestJS (TypeScript) |
| Worker | none (background) | internal | Node + BullMQ |

Rule: web, mobile and master admin are all clients of the SAME API. No page
talks to the database directly.

---------------------------------------------------------------------------
## 2. Repository layout (monorepo)

```
apps/
  api/            REST API, OpenAPI spec, auth, tenant context, rate limits
  worker/         OCR, exports, overdue sweep, billing sync, emails, cleanup
  web/            tenant web UI
  admin/          master admin UI (separate deploy, separate auth)
  mobile/         Expo app
packages/
  db/             Prisma schema, migrations, tenant-scoped client, RLS SQL
  shared/         Zod schemas, types, permission map, plan limits, error codes
  api-client/     typed client generated from OpenAPI (used by web/admin/mobile)
docs/
```

---------------------------------------------------------------------------
## 3. Identity and access

Two completely separate identity systems:

1. **Tenant users** (`User` + `Membership`): belong to one or more organizations.
   Roles per organization: OWNER, ADMIN, STAFF (extend later: VIEWER, ACCOUNTANT).
2. **Platform admins** (`PlatformAdmin`): your staff. Separate table, separate
   login endpoint, separate token audience (`aud=platform`), mandatory MFA,
   optional IP allow-list. A tenant token can never call a platform endpoint.

Platform roles: SUPER_ADMIN, SUPPORT, BILLING, READONLY.

Tokens:
- Access token (JWT, 10-15 min) with: sub, orgId, role, aud.
- Refresh token (rotating, stored hashed, revocable per device).
- Mobile stores tokens in Keychain/Keystore. Web uses httpOnly cookies.
- orgId always comes from the token / membership, NEVER from the request body.

Impersonation ("support access"):
- Platform admin requests access to an org -> creates `SupportSession`
  (reason required, expiry e.g. 30 min, READ_ONLY by default).
- Every action during it is audit-logged with both identities.
- Owner can be notified, and can disable support access in settings.

---------------------------------------------------------------------------
## 4. Multi-tenancy

- Every business table gets `organizationId` (Project, Category, Material,
  Vendor, Invoice, Payment, Note, AuditLog, ActivityLog, ...).
- Uniques become per-tenant: `@@unique([organizationId, name])`,
  `@@unique([organizationId, gstin])`, `@@unique([organizationId, vendorId, invoiceNumber])`.
- Isolation enforced in two layers:
  1. Tenant-scoped Prisma client (extension injects organizationId on every query).
  2. PostgreSQL Row-Level Security using `SET LOCAL app.org_id = ...` per request.
- Mandatory automated tests: user from org A must get 404/403 on every
  endpoint for org B data. CI fails if any endpoint lacks a tenant test.

---------------------------------------------------------------------------
## 5. Data model additions (sketch)

```prisma
model Organization {
  id, name, slug, status        // TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CLOSED
  timezone, currency, country, gstin?
  createdAt, suspendedAt?, suspendedReason?
}
model Membership   { id, userId, organizationId, role, status, invitedBy? }
model Invitation   { id, organizationId, email, role, tokenHash, expiresAt, acceptedAt? }

model Plan         { id, code, name, priceMinor, currency, interval, limits Json, active }
model Subscription { id, organizationId, planId, status, provider, providerCustomerId,
                     providerSubscriptionId, trialEndsAt?, currentPeriodStart, currentPeriodEnd,
                     cancelAtPeriodEnd, overrideLimits Json? }
model UsageCounter { organizationId, period, metric, value  @@unique([organizationId, period, metric]) }
model BillingEvent { id, provider, eventId @unique, type, payload Json, processedAt?, error? }
model BillingInvoice { id, organizationId, number, amountMinor, taxMinor, status, pdfUrl, issuedAt }

model PlatformAdmin   { id, email, passwordHash, role, mfaSecret, active, lastLoginAt }
model SupportSession  { id, platformAdminId, organizationId, reason, mode, startedAt, expiresAt, endedAt? }
model FeatureFlag     { key, description, defaultOn, rules Json }   // per plan / per org overrides
model Announcement    { id, title, body, audience, startsAt, endsAt }
model DataRequest     { id, organizationId, type(EXPORT|DELETE), status, requestedBy, completedAt? }

model AuditLog  { id, at, actorType(USER|PLATFORM|SYSTEM), actorId, organizationId?,
                  action, entityType, entityId, before Json?, after Json?, requestId, ip, userAgent }
                  // append-only: no UPDATE/DELETE grants for the app DB role
```

Money: store integer minor units (paise) or Decimal; never JS floats.
Soft delete (`deletedAt`) for invoices/vendors/projects; payments are never deleted, only reversed.

---------------------------------------------------------------------------
## 6. Master Admin console — what it must do

**Tenants**
- List/search organizations; status, plan, MRR, users, last active, usage vs limits.
- Tenant detail: members, projects, invoice counts, storage, OCR usage, subscription timeline.
- Actions: suspend / reactivate, extend trial, change plan, override limits,
  add credit, resend invite, force logout all sessions, lock/unlock user.
- Support access (impersonation) with reason + expiry + audit.

**Billing**
- Subscriptions, failed payments, dunning state, refunds (via provider).
- Webhook inbox: view `BillingEvent`s, failed ones, **replay** safely (idempotent).
- Plan editor (create plan, change limits, retire plan without breaking subscribers).
- Revenue view: MRR, churn, trials -> paid conversion.

**Operations / health**
- Error explorer (replaces current ApiErrorLog page): filter by org, code, endpoint, requestId, release.
- Job queue dashboard: queued / running / failed OCR + export jobs, retry, dead-letter view.
- System health: API latency p50/p95, DB connections, queue depth, storage, Azure OCR quota.
- Feature flags and kill switches (e.g. disable OCR globally if Azure is down).
- Announcements / maintenance banner.

**Compliance**
- Data export / delete requests workflow with approval and completion log.
- Immutable audit trail viewer (platform actions + tenant actions).
- Admin access review: list of platform admins, last login, MFA status.

**Safety rules for the console**
- Separate deployment and domain, strict CSP, MFA required, short sessions.
- Dangerous actions (suspend, delete, impersonate, plan override) need a reason
  text and are written to AuditLog. Deletions need a second approver.
- `resetApplicationData` from the current app does NOT move into any tenant
  surface. It becomes a platform-only, per-tenant, backup-first, two-person action.

---------------------------------------------------------------------------
## 7. Logging, errors, observability

Three distinct things, do not mix them:

| Kind | Purpose | Storage |
|---|---|---|
| Audit log | Who did what to which record (legal/trust) | Postgres, append-only, retained long |
| Application logs | Debugging | Structured JSON to stdout -> log platform, 30-90 days |
| Errors/metrics | Alerting and health | Sentry + metrics (Prometheus/Grafana or cloud native) |

Every request carries `requestId`; it is logged, returned in error responses,
and stored in AuditLog. Log fields: requestId, orgId, userId, route, status, ms.
Never log passwords, tokens, full invoice contents or card data.

Alerts (minimum): error-rate spike, p95 latency, queue backlog, failed webhooks,
DB connection saturation, backup failure, OCR quota > 80%.

The existing `ApiErrorLog` and `ActivityLog` tables are migrated into the
above (kept readable in the master admin).

---------------------------------------------------------------------------
## 8. Key flows

**Invoice upload (async)**
1. App asks API for a presigned blob upload URL (checks plan limit first).
2. App uploads directly to private blob storage.
3. App calls `POST /invoices` with blobKey -> row in `PROCESSING`, job queued.
4. Worker runs OCR, writes draft, status -> `NEEDS_REVIEW`, increments UsageCounter.
5. Client polls / receives push; user reviews and confirms.

**Payment** — one DB transaction: lock invoice row, recompute paid total,
insert payment, update status/paidAmount. Reject overpayment inside the lock.

**Subscription** — checkout on web -> provider -> signed webhook -> verify
signature -> store `BillingEvent` (unique eventId) -> update `Subscription`
-> entitlements recomputed. The browser redirect never grants access.

**Entitlements** — one function `can(org, feature)` / `withinLimit(org, metric)`
in `packages/shared`, used by API middleware and returned to clients so UI
can show upgrade prompts. Plan overrides from master admin win over plan defaults.

---------------------------------------------------------------------------
## 9. Safe change process ("before changing code")

Working method (current): changes are made directly in this workspace, phase
by phase. Git is NOT required for this method; version control is optional
and can be adopted later without changing anything below.

Environments: local -> test copy (prod-like, anonymised data) -> production.

Before any phase:
1. Make a dated backup copy of the code folder (src/prisma/packages) and take
   and TEST-RESTORE a database backup.
2. Write the phase's acceptance tests first (tenant isolation, payments, auth).
3. Build the phase on the test copy; checks must pass before release:
   lint, typecheck, production build, integration, tenant-isolation suite.

Database changes use expand -> migrate -> contract:
- Expand: add nullable `organizationId` + new tables (old app keeps working).
- Backfill: create "Sanvicasa" organization, set organizationId on all rows.
- Enforce: add NOT NULL, new uniques, RLS (after code uses them).
- Contract: remove old unique constraints/columns in a later release.
- Never run migrations automatically against production from a code push;
  run them as a separate, gated, backed-up step with a rollback plan.

Releases: feature flags for risky features; deploy to staging first; canary
or off-hours production deploy; keep previous version ready for rollback.
Mobile: enforce a minimum supported app version from the API (`/meta`).
API: version it (`/v1`); never break a published version while old apps exist.

---------------------------------------------------------------------------
## 10. Security baseline

- Rotate and remove committed default credentials (README, .env.example, migration).
- Password hashing (argon2id or bcrypt cost >= 12), reset by email, optional MFA for tenant owners.
- Rate limit login, signup, invite, export; lockout with backoff.
- Private blob container, short-lived SAS URLs, virus/type check on upload.
- Secrets in a secret manager; no secrets in the repo or CI logs.
- Dependency scanning and pinned lockfile; NextAuth beta removed (custom JWT).
- Backups: automated, encrypted, point-in-time recovery, quarterly restore drill.
- Privacy: per-tenant export/delete, retention policy, terms + privacy pages.

---------------------------------------------------------------------------
## 11. Performance baseline

- Dashboard numbers via SQL aggregation / summary tables, not JS loops.
- Cursor pagination everywhere; select only needed columns.
- Indexes lead with organizationId; trigram index for search.
- Cache per-tenant reference data (categories, vendors) with tag invalidation.
- DB pooler; API stateless and horizontally scalable.
- Targets to track: API p95 < 300 ms for list endpoints, dashboard < 1 s,
  upload-to-draft < 30 s, mobile cold start < 3 s.

---------------------------------------------------------------------------
## 12. Phased plan (each phase ships on its own)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Security cleanup, backup tested, staging env, CI gates | Old creds rotated; restore drill passed |
| 1 | Monorepo + `packages/db` + `shared`; Organization/Membership; backfill; tenant client + RLS | Tenant-isolation suite green; app unchanged for users |
| 2 | API v1 (auth, tokens, projects, invoices, payments, vendors, categories); web switches over | Web runs fully on API; payment race fixed |
| 3 | Worker + async upload + SAS URLs; dashboard aggregation; pagination | Dashboard < 1 s on large test data |
| 4 | Plans, subscriptions, usage metering, webhooks, entitlements | Test-mode checkout works end to end |
| 5 | Master admin console v1 (tenants, support access, audit, errors, billing events, flags) | Support can resolve a tenant issue without DB access |
| 6 | Signup/onboarding, invites, password reset, MFA | New company self-serves from signup to first invoice |
| 7 | Expo mobile app on the same API; private distribution first; white-label (section 13) | Staff can upload/review/pay from phone; branding loads per company |
| 8 | Hardening: load test, alerts, DR drill, legal pages, public launch | Launch checklist signed off |

Open decisions to settle before Phase 1:
1. Payment provider (Razorpay vs Stripe) and whether you sell outside India.
2. Hosting target (Azure Container Apps vs VPS/Docker) and managed Postgres provider.
3. Roles beyond ADMIN/STAFF (accountant, viewer, project manager)?
4. Whether customers need SSO or an API for their own integrations.
5. Data residency / retention promises you will make to customers.

---------------------------------------------------------------------------
## 13. White-label and app-store publishing

Three models (see the client PDF for the plain-language version):

| Model | How | Use when |
|---|---|---|
| A. One shared app, runtime branding (DEFAULT) | One bundle id in our store accounts. After sign-in the app loads the company's brand (name, logo, colours) from the API. | Most customers |
| B. Branded app per client under OUR store accounts | One codebase, a build per client (own name/icon/ids), all published by us. | A few clients; check store rules first |
| C. Branded app per client under the CLIENT's accounts | Same builds; client owns Apple/Google accounts, we upload via delegated roles. | Clients who require their own store presence |

Store policy notes (sources dated 2017-2023, partly informal; re-check before each submission):
- Apple: template/app-generation apps are accepted when submitted directly by the provider of the app's content (guideline 4.2.6 as revised); guideline 4.3 (spam/duplicates) is also used against near-identical apps.
- Google Play: no white-label rule as such; the repetitive-content policy treats several apps with highly similar functionality and experience as a violation.
- Therefore: keep separately branded apps few, give each a real owner/publisher, and prefer Model A + C over B.

Technical design:
- `Organization` gains brand fields: displayName, logoUrl, primaryColor, accentColor, supportEmail, supportUrl, customDomain?, appModel (A|B|C).
- `GET /v1/branding` (by company code or after sign-in) feeds web and mobile theming at runtime; logo changes need no store release.
- Mobile: one codebase with an `app.config` that reads a per-client variant (name, iOS bundle id, Android package, icon, splash, notification keys) selected by an environment variable per build profile (Expo variants pattern). Each variant needs a unique bundle id / package name that cannot change after publishing.
- Admin console: brand editor, store-listing status per client (account created, listing drafted, in review, live), build/version matrix, notification-key storage (encrypted).
- Release pipeline: every app release is built once per variant; keep variants few and automate the build matrix.
- Over-the-air JS updates may ship fixes without a store review where store policy allows; native changes still need a full submission.

Per-client checklist: brand kit (name, logo, 1024x1024 icon, colours, splash, 1024x500 Play graphic, screenshots); unique app identifiers; store accounts (organisation accounts need a D-U-N-S number); public privacy-policy and support URLs; Google data-safety form, Apple privacy details, content rating; in-app account deletion; demo login for reviewers; per-app push credentials (APNs/FCM); optional client web domain and email sender domain.

Costs (indicative): Model C = client pays about USD 99/yr (Apple) and about USD 25 once (Google). Models A/B use our accounts.

---------------------------------------------------------------------------
## 14. Working method (phase by phase)

1. Agree the phase scope and acceptance checks.
2. Backup: dated copy of the code folders + tested database backup.
3. Build on the test copy; keep changes additive first (expand), migrate data, remove old structures last (contract).
4. Run checks: lint, typecheck, production build, tenant-isolation tests.
5. Demo and sign-off by the client/owner.
6. Release, then start the next phase. Risky features go behind per-company switches.

Git, CI and hosting changes are deliberately OUT of scope for now; the deploy
files in the repo are unused until the hosting work is scheduled.
