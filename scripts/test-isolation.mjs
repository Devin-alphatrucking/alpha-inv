// Cross-company isolation test runner (step 2d of docs/PHASE-2-COMPANIES.md).
//
// Needs a PostgreSQL server where you can create a database and a role, e.g. the
// local Docker one (`npm run db:up`):
//   TEST_ADMIN_DATABASE_URL="postgresql://invoice_crm:invoice_crm_dev_password@localhost:5433/postgres" npm run test:isolation
//
// It creates a throwaway database, applies EVERY migration with Prisma, creates the
// ordinary `app_runtime` role exactly like production (so Row-Level Security really
// applies), runs apps/web/tests/isolation.test.ts as that role, then drops the database.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { Client } = require("pg");

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!adminUrl) {
  console.error("Set TEST_ADMIN_DATABASE_URL to a connection string with permission to create databases and roles.");
  process.exit(2);
}

const dbName = `isolation_${randomBytes(4).toString("hex")}`;
const appPassword = randomBytes(12).toString("hex");

function withDb(url, name, user, password) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

const ownerUrl = withDb(adminUrl, dbName);
const appUrl = withDb(adminUrl, dbName, "app_runtime", appPassword);

async function exec(url, sql) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

let exitCode = 1;
try {
  await exec(adminUrl, `CREATE DATABASE "${dbName}"`);
  console.log(`Created throwaway database ${dbName}`);

  const dbDir = path.join(root, "packages", "db");
  const mig = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: ownerUrl, MIGRATE_DATABASE_URL: ownerUrl },
    stdio: "inherit",
    shell: true,
  });
  if (mig.status !== 0) throw new Error("prisma migrate deploy failed");

  const roleSql = fs
    .readFileSync(path.join(dbDir, "prisma", "rls-setup", "app-role.sql"), "utf8")
    .replace(":app_password", `'${appPassword}'`);
  await exec(ownerUrl, roleSql);
  console.log("Created app_runtime role (ordinary role, no BYPASSRLS)");

  const emailFile = path.join(os.tmpdir(), `outbox-${dbName}.jsonl`);
  const suites = (process.env.ISOLATION_SUITES || "tests/isolation.test.ts,tests/auth-flows.test.ts,tests/plans.test.ts,tests/billing.test.ts,tests/master.test.ts,tests/mobile.test.ts,tests/hardening.test.ts,tests/twofactor.test.ts,tests/lock.test.ts,tests/digest.test.ts,tests/budget.test.ts,tests/gst.test.ts,tests/bulk.test.ts,tests/rates.test.ts,tests/comments.test.ts,tests/master-tools.test.ts").split(",");
  exitCode = 0;
  for (const suite of suites) {
    console.log(`
=== ${suite} ===`);
    const test = spawnSync("npx", ["tsx", suite], {
      cwd: path.join(root, "apps", "web"),
      env: {
        ...process.env,
        // ISOLATION_APP_AS_OWNER=1 is a self-check: with RLS bypassed, the database-layer tests MUST fail.
        DATABASE_URL: process.env.ISOLATION_APP_AS_OWNER ? ownerUrl : appUrl,
        TEST_OWNER_DATABASE_URL: ownerUrl,
        AUTH_SECRET: "isolation-suite-secret-value",
        APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        // emails are written to a file the tests read (never really sent)
        EMAIL_TRANSPORT: "file",
        EMAIL_FILE: emailFile,
        APP_URL: "http://app.test",
        SUPPORT_EMAIL: "support@vendor.test",
      },
      stdio: "inherit",
      shell: true,
    });
    if ((test.status ?? 1) !== 0) exitCode = test.status ?? 1;
  }
  fs.rmSync(emailFile, { force: true });
} catch (error) {
  console.error(error);
} finally {
  try {
    await exec(adminUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    console.log(`Dropped ${dbName}`);
  } catch (e) {
    console.error("Could not drop the test database:", e.message);
  }
}
process.exit(exitCode);
