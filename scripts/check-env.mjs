// Reads your settings (the .env file at the repo root, plus anything set in the environment) and says, service by service,
// what is set, what is missing and what looks wrong. Never prints a secret.   npm run check:env
// Guide: docs/ENVIRONMENT-SETUP.md
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.env.ENV_FILE || join(root, ".env");

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const fromFile = existsSync(file) ? parse(readFileSync(file, "utf8")) : {};
const env = { ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) };
const get = (k) => (env[k] ?? "").trim();
const has = (k) => get(k) !== "";
const PLACEHOLDER = /^(replace-with|<|your-|changeme|xxx)/i;
const isPlaceholder = (v) => PLACEHOLDER.test(v) || v.includes("<your") || v.includes("<key-from");

const production = get("NODE_ENV") === "production" || /^https:\/\//.test(get("APP_URL")) && !get("APP_URL").includes("localhost");

/** Results: ok = set and plausible; missing = not set; bad = set but looks wrong; info = a note. */
const OK = "ok", MISSING = "missing", BAD = "bad", INFO = "info";
const sections = [];
function section(title, level, fn) {
  const rows = [];
  const add = (status, name, note = "") => rows.push({ status, name, note });
  fn(add);
  sections.push({ title, level, rows });
}

const base64Key = (k) => {
  const v = get(k);
  if (!v) return null;
  if (isPlaceholder(v)) return "still the example value";
  try {
    return Buffer.from(v, "base64").length === 32 ? null : "must be 32 random bytes, base64 (see the guide)";
  } catch {
    return "not valid base64";
  }
};
const secretLen = (k, min) => {
  const v = get(k);
  if (!v) return null;
  if (isPlaceholder(v)) return "still the example value";
  return v.length >= min ? null : `too short (needs ${min}+ characters)`;
};

section("1. Database and secrets", "required", (add) => {
  const db = get("DATABASE_URL");
  if (!db) add(MISSING, "DATABASE_URL", "where the app connects to Postgres");
  else if (!/^postgres(ql)?:\/\//.test(db)) add(BAD, "DATABASE_URL", "should start with postgresql://");
  else {
    add(OK, "DATABASE_URL");
    if (production && /invoice_crm_dev_password|\/\/postgres:/.test(db)) add(BAD, "DATABASE_URL", "looks like a development or admin login; production should use the app_runtime role");
  }
  if (production && !has("MIGRATE_DATABASE_URL")) add(INFO, "MIGRATE_DATABASE_URL", "not set: fine if migrations run from another machine");
  else if (has("MIGRATE_DATABASE_URL")) add(OK, "MIGRATE_DATABASE_URL");

  for (const [k, min] of [["AUTH_SECRET", 24]]) {
    const problem = secretLen(k, min);
    if (!has(k) && !has("NEXTAUTH_SECRET")) add(MISSING, k, "signs sign-in sessions");
    else if (problem) add(BAD, k, problem);
    else add(OK, k);
  }
  const enc = base64Key("APP_ENCRYPTION_KEY");
  if (!has("APP_ENCRYPTION_KEY")) add(MISSING, "APP_ENCRYPTION_KEY", "needed to save a project's own Azure key");
  else if (enc) add(BAD, "APP_ENCRYPTION_KEY", enc);
  else add(OK, "APP_ENCRYPTION_KEY", "back it up somewhere safe");
  if (has("MOBILE_TOKEN_SECRET")) {
    const p = secretLen("MOBILE_TOKEN_SECRET", 24);
    add(p ? BAD : OK, "MOBILE_TOKEN_SECRET", p ?? "");
    if (!p && get("MOBILE_TOKEN_SECRET") === get("AUTH_SECRET")) add(INFO, "MOBILE_TOKEN_SECRET", "same as AUTH_SECRET: works, but a separate value is better");
  } else add(INFO, "MOBILE_TOKEN_SECRET", "not set: AUTH_SECRET is used instead");
});

section("2. Email", "required", (add) => {
  const transport = get("EMAIL_TRANSPORT");
  const smtp = has("SMTP_HOST");
  if (transport === "none" || (!smtp && production && transport !== "file")) add(MISSING, "SMTP_HOST", "no sign-up codes, password resets or invitations without email");
  else if (!smtp) add(INFO, "SMTP_HOST", "not set: mails are written to .data/outbox.jsonl (development only)");
  else {
    add(OK, "SMTP_HOST");
    for (const k of ["SMTP_USER", "SMTP_PASS"]) add(has(k) ? OK : BAD, k, has(k) ? "" : "most providers need a username and password");
    const port = get("SMTP_PORT");
    if (port && !["25", "465", "587", "2525"].includes(port)) add(INFO, "SMTP_PORT", `${port} is unusual (587 or 465 are normal)`);
  }
  const from = get("EMAIL_FROM");
  if (!from) add(production ? MISSING : INFO, "EMAIL_FROM", "the sender people see");
  else if (/localhost|yourdomain\.com/.test(from)) add(production ? BAD : INFO, "EMAIL_FROM", "still an example address");
  else add(OK, "EMAIL_FROM");
  add(has("SUPPORT_EMAIL") ? OK : INFO, "SUPPORT_EMAIL", has("SUPPORT_EMAIL") ? "" : "not set: where customers' support requests go");
});

section("3. Public address and settings", "required", (add) => {
  const url = get("APP_URL");
  if (!url) add(production ? MISSING : INFO, "APP_URL", "links in emails are built from it");
  else if (production && !/^https:\/\//.test(url)) add(BAD, "APP_URL", "production should be https");
  else if (production && /localhost/.test(url)) add(BAD, "APP_URL", "still localhost");
  else add(OK, "APP_URL");
  const auth = get("AUTH_URL") || get("NEXTAUTH_URL");
  if (!auth) add(INFO, "AUTH_URL", "not set");
  else if (url && auth.replace(/\/+$/, "") !== url.replace(/\/+$/, "")) add(BAD, "AUTH_URL", "differs from APP_URL (they should be the same address)");
  else add(OK, "AUTH_URL");
  for (const k of ["TERMS_URL", "PRIVACY_URL"]) {
    if (!has(k)) add(INFO, k, "not set: advised before launch");
    else add(/^https:\/\//.test(get(k)) ? OK : BAD, k, /^https:\/\//.test(get(k)) ? "" : "https only");
  }
});

section("4. Azure Document Intelligence (AI invoice reading)", "optional", (add) => {
  const e = get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
  const k = get("AZURE_DOCUMENT_INTELLIGENCE_KEY");
  if (!e && !k) return add(MISSING, "AZURE_DOCUMENT_INTELLIGENCE_*", "invoices are not read by AI until set (here or per project)");
  if (!e || isPlaceholder(e)) add(e ? BAD : MISSING, "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", e ? "still the example value" : "set both or neither");
  else add(/^https:\/\/.+\.(cognitiveservices\.azure\.com|cognitive\.microsoft\.com)\/?$/.test(e) ? OK : INFO, "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "");
  if (!k || isPlaceholder(k)) add(k ? BAD : MISSING, "AZURE_DOCUMENT_INTELLIGENCE_KEY", k ? "still the example value" : "set both or neither");
  else add(OK, "AZURE_DOCUMENT_INTELLIGENCE_KEY");
});

section("5. Azure Blob Storage (uploaded files)", production ? "required" : "optional", (add) => {
  const c = get("AZURE_STORAGE_CONNECTION_STRING");
  if (!c) return add(production ? MISSING : INFO, "AZURE_STORAGE_CONNECTION_STRING", "files stay on the server's disk (lost when the server moves or restarts)");
  add(/AccountName=.+;.*AccountKey=|DefaultEndpointsProtocol=|BlobEndpoint=/i.test(c) ? OK : BAD, "AZURE_STORAGE_CONNECTION_STRING", /AccountName=|DefaultEndpointsProtocol=|BlobEndpoint=/i.test(c) ? "" : "does not look like a connection string");
  add(has("AZURE_STORAGE_CONTAINER_NAME") ? OK : MISSING, "AZURE_STORAGE_CONTAINER_NAME");
});

section("6. Razorpay (plan payments)", "optional", (add) => {
  const id = get("RAZORPAY_KEY_ID");
  const secret = get("RAZORPAY_KEY_SECRET");
  const hook = get("RAZORPAY_WEBHOOK_SECRET");
  if (!id && !secret) return add(INFO, "RAZORPAY_*", "not set: payments are off (customers are asked to contact support)");
  if (!/^rzp_(test|live)_/.test(id)) add(BAD, "RAZORPAY_KEY_ID", "should start with rzp_test_ or rzp_live_");
  else add(OK, "RAZORPAY_KEY_ID", id.startsWith("rzp_live_") ? "LIVE mode" : "test mode");
  add(secret ? OK : MISSING, "RAZORPAY_KEY_SECRET");
  const w = secretLen("RAZORPAY_WEBHOOK_SECRET", 16);
  add(!hook ? MISSING : w ? BAD : OK, "RAZORPAY_WEBHOOK_SECRET", !hook ? "without it Razorpay's messages are refused" : (w ?? ""));
  if (production && id.startsWith("rzp_test_")) add(BAD, "RAZORPAY_KEY_ID", "test key on a production address");
  if (has("BILLING_CRON_SECRET")) {
    const p = secretLen("BILLING_CRON_SECRET", 16);
    add(p ? BAD : OK, "BILLING_CRON_SECRET", p ?? "");
  } else add(INFO, "BILLING_CRON_SECRET", "not set: the daily safety-net check is off");
});

section("7. Google sign-in", "optional", (add) => {
  const id = get("GOOGLE_CLIENT_ID");
  const secret = get("GOOGLE_CLIENT_SECRET");
  if (!id && !secret) return add(INFO, "GOOGLE_*", "not set: no Google buttons");
  add(id.endsWith(".apps.googleusercontent.com") ? OK : BAD, "GOOGLE_CLIENT_ID", id.endsWith(".apps.googleusercontent.com") ? "" : "should end with .apps.googleusercontent.com");
  add(secret ? OK : MISSING, "GOOGLE_CLIENT_SECRET", secret ? "" : "set both or neither");
});

section("8. Scheduler", "optional", (add) => {
  if (!has("JOBS_SECRET")) return add(MISSING, "JOBS_SECRET", "daily digest and trial emails are off");
  const p = secretLen("JOBS_SECRET", 16);
  add(p ? BAD : OK, "JOBS_SECRET", p ?? "now make something call /api/jobs/digest and /api/jobs/trial-notices every hour");
  const h = get("DIGEST_HOUR");
  if (h && !(Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23)) add(BAD, "DIGEST_HOUR", "a whole number from 0 to 23");
});

section("9. Master console address", "optional", (add) => {
  const host = get("MASTER_HOST");
  if (!host) return add(production ? MISSING : INFO, "MASTER_HOST", "the console is on /master of the customers' address");
  add(/^[a-z0-9.-]+(:\d+)?$/i.test(host) && !host.startsWith("http") ? OK : BAD, "MASTER_HOST", /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !host.startsWith("http") ? "" : "an address only, like admin.yourdomain.com (no https://)");
  add(has("SECURITY_ALERT_EMAIL") ? OK : INFO, "SECURITY_ALERT_EMAIL", has("SECURITY_ALERT_EMAIL") ? "" : "not set: only the operator is told about unusual sign-ins");
});

// ---- Print
const mark = { [OK]: "OK     ", [MISSING]: "MISSING", [BAD]: "CHECK  ", [INFO]: "note   " };
let required = 0;
let advised = 0;
console.log(`Settings read from ${existsSync(file) ? file : "the environment (no .env file found)"}${production ? "  [looks like production]" : "  [development]"}\n`);
for (const s of sections) {
  console.log(`${s.title}  (${s.level})`);
  for (const r of s.rows) {
    console.log(`  ${mark[r.status]} ${r.name}${r.note ? `  ${r.note}` : ""}`);
    if (r.status === MISSING || r.status === BAD) {
      if (s.level === "required") required++;
      else advised++;
    }
  }
  console.log();
}
console.log(required === 0 ? "All required settings are in place." : `${required} required setting${required === 1 ? "" : "s"} to fix (see docs/ENVIRONMENT-SETUP.md).`);
if (advised) console.log(`${advised} optional setting${advised === 1 ? "" : "s"} not set or to check.`);
process.exit(required === 0 ? 0 : 1);
