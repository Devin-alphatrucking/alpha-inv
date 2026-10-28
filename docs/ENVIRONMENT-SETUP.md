# Getting every key and setting (the .env guide)

Every secret and setting the product needs, what each is for, **where to get it**, and what happens if it is missing.
Work top to bottom: the first section is enough to run the product; every later section switches one service on.

- **Where they go.** Locally: one `.env` file at the repo root (copy `.env.example`; never commit it). On a server: the host's
  environment settings (Vercel, Azure App Service, Docker `-e`, and so on). Variables set by the host win over the file.
- **Check yourself.** Run `npm run check:env` at the repo root. It reads your `.env` (or the host's variables) and tells you,
  service by service, what is set, what is missing, and what looks wrong. It never prints a secret.
- **Secrets stay secret.** Never paste a key into chat, email or git. If one leaks, rotate it (every section below says how).

## The order to do things in

1. Database and the three secrets (section 1): the product runs.
2. Email (section 2): sign-up codes, password reset and invitations work. Without it people cannot sign up.
3. Your public address (section 3): links in emails and sign-in work on your real domain.
4. Azure Document Intelligence (section 4): invoices are read by AI.
5. Azure Blob Storage (section 5): uploaded files survive server restarts. **Needed in production.**
6. Razorpay (section 6): customers can pay for plans.
7. Google sign-in (section 7): optional.
8. Scheduler (section 8): daily digest, trial emails, billing safety net.
9. Master console address (section 9): keep the console off the customers' address.
10. Phone app (section 10).

## 1. Database and secrets (required)

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | How the app connects to Postgres. In production it must use the ordinary `app_runtime` role so row-level security protects companies from each other. | Your Postgres host (Azure Database for PostgreSQL, Neon, Supabase, RDS...). Create the role once with `packages/db/prisma/rls-setup/app-role.sql`, then use that role's password in this URL. Local: already set for Docker (`npm run db:up`). |
| `MIGRATE_DATABASE_URL` | The **owner** role, used only to apply database changes (`npm run db:deploy`) and to seed. Leave empty on a local database with no separate app role. | Same Postgres host: the admin/owner user it gave you. Keep it off the running app server if you can. |
| `AUTH_SECRET` | Signs sign-in sessions. | Make one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it signs everyone out. |
| `APP_ENCRYPTION_KEY` | Encrypts keys saved inside the database (each project's own Azure key). **Back it up**: if lost, saved project keys must be typed in again. | Same command as above (must be 32 random bytes, base64). |
| `MOBILE_TOKEN_SECRET` | Signs the phone app's download links. Optional: falls back to `AUTH_SECRET`. | Same command. Use a different value from `AUTH_SECRET`. |
| `AUTH_TRUST_HOST` | `true` when the app is behind a proxy or tunnel (almost always in production). | Just set `true`. |

Without `DATABASE_URL` or `AUTH_SECRET` nothing starts. Without `APP_ENCRYPTION_KEY` the app runs but a project's own Azure key cannot be saved.

## 2. Email (required for sign-up, password reset, invitations, trial notices, daily digest)

| Variable | What it is |
| --- | --- |
| `EMAIL_TRANSPORT` | `smtp` for real delivery. Leave empty to auto-pick (SMTP when `SMTP_HOST` is set; a local file in development; nothing in production). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Your mail provider's SMTP details. Port 587 (or 465 for SSL). |
| `EMAIL_FROM` | The sender people see, like `Invoice & Billing <no-reply@yourdomain.com>`. Must be an address your provider is allowed to send from. |
| `SUPPORT_EMAIL` | Where customers' support requests are sent. |

**Where to get SMTP details.** Any mail provider with SMTP: Azure Communication Services Email, Amazon SES, SendGrid, Brevo,
Postmark, Zoho or Google Workspace. In the provider's dashboard look for "SMTP" or "SMTP credentials". Steps that apply to all of them:

1. Add and **verify your domain** (they give you DNS records: SPF, DKIM; add DMARC too). Without this, mail goes to spam.
2. Create SMTP credentials; copy host, port, username and password into the variables above.
3. Send yourself a test: sign up with a new email on your site and confirm the code arrives.

Development needs nothing: mails are written to `.data/outbox.jsonl` instead of being sent.

## 3. Your public address and general settings

| Variable | What it is | Default / note |
| --- | --- | --- |
| `APP_URL` | The public address of the app (`https://app.yourdomain.com`). Every link in an email is built from it. **Required in production.** | `http://localhost:3000` |
| `AUTH_URL` | Same address, for sign-in. Must match what people type, and the Google redirect (section 7). | `http://localhost:3000` |
| `PRODUCT_NAME` | Name shown where no company branding applies. | `Invoice & Billing` |
| `TERMS_URL`, `PRIVACY_URL` | Links next to "I agree" on sign-up (https only). Strongly advised before launch. | empty |
| `SIGNUP_ENABLED` | `false` turns off self-service sign-up. | `true` |
| `LANDING_PAGE` | `off` for a deployment that is one company's own app (the front page goes to sign-in). | `on` |
| `TRIAL_DAYS` | Length of the free trial for self-service sign-ups. | `14` |
| `TRUSTED_PROXY_HOPS` | How many proxies sit in front of the app (so sign-in limits count the real visitor). Behind Cloudflare, rely on its `cf-connecting-ip`. | `1` |
| `SESSION_RECHECK_MS` | How often a signed-in session is re-checked against the database (milliseconds). | `60000` |

## 4. Azure Document Intelligence (AI that reads invoices)

| Variable | What it is |
| --- | --- |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | `https://<your-resource-name>.cognitiveservices.azure.com/` |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Key 1 or Key 2 of that resource |

**How to get them**

1. Sign in at portal.azure.com (create an Azure account if you have none; a card is needed).
2. **Create a resource** > search **Document Intelligence** (formerly Form Recognizer) > Create.
   Choose a subscription and resource group, a region near your users (for India, **Central India** or **South India**) and the
   **Standard (S0)** pricing tier for production. The free tier (F0) is fine for testing but is limited to a few pages a month.
3. When it is created, open it > **Keys and Endpoint**. Copy **Endpoint** and **KEY 1** into the two variables.
4. Restart the app. Upload one invoice to test.

Notes: these two are the **server-wide default**. A project can also keep its own endpoint and key (Projects > Edit); those are
encrypted with `APP_ENCRYPTION_KEY` (section 1), so that must be set first. Rotate: Keys and Endpoint > Regenerate Key 2, switch the app to it, then regenerate Key 1.

## 5. Azure Blob Storage (uploaded invoice files)

| Variable | What it is |
| --- | --- |
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string of a storage account. Empty = files are kept on the server's own disk (`.data/uploads`), which is **lost on most hosts when the server restarts or moves**. |
| `AZURE_STORAGE_CONTAINER_NAME` | Container name, for example `invoices`. |

**How to get them**

1. portal.azure.com > **Create a resource** > **Storage account**. Redundancy: LRS or GRS; performance Standard; region same as above.
2. Open the account > **Containers** > **+ Container**, name it `invoices`, access level **Private**.
3. **Security + networking** > **Access keys** > **Show** > copy **Connection string** (key1).
4. Put both values in the settings and restart. Upload an invoice and check it appears in the container.

Site photos and drawings use the same storage. Never make the container public.

## 6. Razorpay (customers paying for plans)

| Variable | What it is |
| --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API keys. Leave empty to keep payments off (customers are asked to contact support). |
| `RAZORPAY_WEBHOOK_SECRET` | A secret **you choose**, typed into both Razorpay and here. |
| `BILLING_GRACE_DAYS` | Days after the first failed charge before adding things is paused. Default `7`. |
| `BILLING_CRON_SECRET` | Optional pass (16+ characters) for the daily safety-net call in section 8. |
| `RAZORPAY_BASE_URL` | Leave unset (only for testing against a stand-in). |

**How to get them**

1. Sign up at razorpay.com and complete business verification (KYC) for live payments. Test mode works immediately.
2. Dashboard > switch to **Test mode** > **Account & Settings** > **API Keys** > **Generate Key**. Copy the Key Id (`rzp_test_...`) and Key Secret (shown once).
3. Dashboard > **Account & Settings** > **Webhooks** > **Add new webhook**.
   - URL: `<APP_URL>/api/billing/razorpay/webhook`
   - Secret: invent a long random string; use the same one for `RAZORPAY_WEBHOOK_SECRET`.
   - Events: tick all `subscription.*` events (authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed, updated).
4. In the master console, set a price on the plan (Plans and prices) and try a purchase with Razorpay's test card.
5. **Going live:** repeat in Live mode, replace the three values with the live ones (`rzp_live_...`) and add a live webhook. Do not mix test and live values.

## 7. Google sign-in (optional)

| Variable | What it is |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client of your Google Cloud project. Leave both empty to hide the Google buttons. |

**How to get them** (details in `docs/GOOGLE-SIGN-IN.md`)

1. console.cloud.google.com > create or choose a project.
2. **APIs & Services** > **OAuth consent screen**: app name, support email, your terms and privacy links. Publish it to production when ready (testing mode allows only listed testers).
3. **Credentials** > **Create credentials** > **OAuth client ID** > **Web application**.
   Authorised redirect URI: `<AUTH_URL>/api/auth/callback/google` (add the localhost one too for testing).
4. Copy the Client ID and Client secret into the two variables and restart.

## 8. Scheduler (jobs that run by themselves)

| Variable | What it is |
| --- | --- |
| `JOBS_SECRET` | A password (16+ characters) the scheduler sends. Empty switches the jobs **off**. Make one with the command in section 1. |
| `DIGEST_HOUR` | Hour (0-23, company time) the daily digest goes out. Default `8`. |

Something on your host must call these addresses once an hour with the header `Authorization: Bearer <JOBS_SECRET>` (POST):

- `<APP_URL>/api/jobs/digest`: the daily email to administrators.
- `<APP_URL>/api/jobs/trial-notices`: "your trial is ending" and "your trial has ended".
- `<APP_URL>/api/jobs/quiet-notices`: a friendly check-in to the administrators of a company nobody has used for two weeks (at most once a month, never after 90 days quiet).

And once a day, with `Authorization: Bearer <BILLING_CRON_SECRET>`: `<APP_URL>/api/billing/reconcile` (re-reads unfinished Razorpay purchases, a safety net for a missed webhook).

Any scheduler works: GitHub Actions (`schedule:` cron), Azure Logic Apps or Functions, Vercel Cron, cron-job.org or a plain server cron with `curl -X POST -H "Authorization: Bearer ..." <url>`. Safe to call as often as you like.

## 9. Master console address (recommended)

| Variable | What it is |
| --- | --- |
| `MASTER_HOST` | The only address where the console exists, like `admin.yourdomain.com`. Empty = console at `/master` on the customers' address. |
| `SECURITY_ALERT_EMAIL` | Who is told about unusual console sign-ins (comma separated). |

Add a second domain name pointing at the same app, then set these. Details: `docs/MASTER-CONSOLE-ACCESS.md`. Make your own account an operator first with `npm run master -- add <your email>` (the account must exist with a verified email), then turn on two-step sign-in on its Account page. Without two-step the console stays locked.

## 10. Phone app (set when building the app, not on the server)

| Variable | What it is |
| --- | --- |
| `API_URL` | The server address the app talks to (your `APP_URL`). |
| `APP_NAME`, `APP_SLUG`, `APP_BUNDLE_ID`, `APP_PRIMARY_COLOR`, `APP_VERSION` | Branding of the built app. The bundle id (like `com.yourcompany.app`) must be yours before store submission. |

Building and publishing the store apps needs an **Apple Developer** account (US$99 a year) and a **Google Play Console** account (one-off US$25). Details: `docs/PHASE-8-MOBILE-APP.md`.

## Seed script (first company on a fresh database)

`SEED_COMPANY_NAME`, `SEED_COMPANY_SLUG`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD`. Leave the passwords empty to get random ones printed once by `npm run db:seed`. Change them after the first sign-in.

## Quick reference: what breaks without what

| Missing | Effect |
| --- | --- |
| `DATABASE_URL`, `AUTH_SECRET` | The app does not start. |
| SMTP settings | No sign-up codes, password resets, invitations or emails of any kind. |
| `APP_URL` | Links in emails point at localhost. |
| Azure Document Intelligence | Invoices are not read by AI: uploads say "AI extraction is not set up" until an endpoint and key are added (here or on the project). |
| Azure Blob Storage | Uploads sit on the server's disk and can be lost. |
| `RAZORPAY_*` | No online payment; customers are told to contact support. |
| `JOBS_SECRET` or no scheduler | No daily digest or trial emails. |
| `APP_ENCRYPTION_KEY` | A project's own Azure key cannot be saved. |
| Google keys | No Google buttons (nothing else changes). |

## Going live checklist

- [ ] Production database with the `app_runtime` role; `DATABASE_URL` uses it, `MIGRATE_DATABASE_URL` is the owner.
- [ ] New random `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `MOBILE_TOKEN_SECRET`, `JOBS_SECRET` (not the development ones). `APP_ENCRYPTION_KEY` backed up somewhere safe.
- [ ] Domain verified with your mail provider; a real sign-up email arrives in the inbox, not spam.
- [ ] `APP_URL` and `AUTH_URL` are the real https address. `TERMS_URL` and `PRIVACY_URL` set.
- [ ] Azure Blob Storage set; Document Intelligence on the S0 tier.
- [ ] Razorpay live keys and live webhook; one real small purchase tried and refunded.
- [ ] Scheduler calling the two jobs hourly and the billing reconcile daily.
- [ ] `MASTER_HOST` set, your operator account has two-step sign-in.
- [ ] Test keys and test secrets rotated or removed.
