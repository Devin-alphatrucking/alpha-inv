# Phase 7: Mobile API (foundation for the iOS and Android apps)

Status: API BUILT and tested (15 database checks, token unit tests, and a run over HTTP against the built app). The Expo app itself is the next step and is NOT built yet.

## 1. How the apps sign in (same accounts, no separate backend)

The apps use the same database, accounts, companies and rules as the website. They call `/api/v1/...` on the same server with a **bearer token** instead of a cookie.

- **Access token** (15 minutes): names a sign-in session. Who the person is, their company and role are read from the database on EVERY request, so a token never carries stale permissions.
- **Refresh token** (60 days, up to 180 days in total): used to get a new pair. It is **rotated on every use** and only its SHA-256 is stored. Showing an OLD refresh token again means it was copied: the whole session is revoked and logged. Two refreshes at the same moment from one device are not treated as theft (the second gets `409 refresh_in_progress`: retry).
- Ends at once, on the next request: **sign out everywhere** or a password change (website or app), logout, removal from the company, a suspended or closed company, a deleted account.
- Same safeguards as the website: verified email required, 10 wrong tries per email per 15 minutes (shared counter with the website), 40 per network address.
- The existing routes that use the signed-in person also accept the bearer token with no change: `POST /api/invoices/upload`, `GET /api/invoices/{id}/file`, `GET /api/admin/export`. Browsers still use cookies; a cookie-less call without a token is refused.
- Store the refresh token in the phone's secure storage (iOS Keychain / Android Keystore via `expo-secure-store`), never in plain storage.

## 2. Endpoints (all JSON; errors are `{ "error": "...", "code": "..." }`)

| Call | What it does |
|---|---|
| `POST /api/v1/auth/login` `{ email, password, deviceName?, platform?: "ios"\|"android", appVersion? }` | `{ tokens: { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt } }`. Codes: `invalid_credentials` 401, `email_not_verified` 403, `no_company` 403, `rate_limited` 429 |
| `POST /api/v1/auth/refresh` `{ refreshToken }` | New `tokens`. Codes: `invalid_refresh` / `session_ended` 401, `refresh_in_progress` 409 (retry), `rate_limited` 429 |
| `POST /api/v1/auth/logout` | Ends this device's session |
| `GET /api/v1/me` | `user`, `company` (id and public branding: name, logo, colours, support contact, number and date formats), `companies` (all the person belongs to), `plan` (state, plain-language `message` when adding is paused, limits, usage, trial and period dates) |
| `POST /api/v1/me/company` `{ companyId }` | Switch the session to another company the person belongs to |
| `GET /api/v1/projects` | Active projects this person may use (all for an administrator, assigned for staff) |
| `GET /api/v1/categories` | Categories for the upload form |
| `GET /api/v1/invoices?q&status&projectId&page&pageSize` | Invoices the person may see, newest first (max 50 per page) |
| `GET /api/v1/invoices/{id}` | One invoice with vendor, project, category and line items, and `fileUrl` |
| `POST /api/invoices/upload` (multipart: `file`, `projectId`, `categoryId`) | Upload an invoice for AI reading. Returns `invoiceId`, and a duplicate warning. Refused with a plain message when the company's plan is not in good standing or a page limit is reached |

`plan.state` is one of `trial`, `active`, `past_due_grace`, `past_due`, `canceling`, `canceled`, `trial_expired`, `none`. Show `plan.message` when it is not empty. Do not sell or link to buying project plans inside the apps (store rules); buying stays on the website.

## 3. Setup

Nothing new is required: access tokens are signed with `AUTH_SECRET`. To use a separate secret for mobile tokens set `MOBILE_TOKEN_SECRET` (changing it signs every phone out). Run the new migration `20261027090000_mobile_sessions`.

## 4. Not built yet

The Expo app (login, invoice list and detail, camera upload, offline queue, push notifications), listing and revoking a person's devices on the Account page and in the master console, a minimum-app-version check, certificate pinning, and a public version/config endpoint.
