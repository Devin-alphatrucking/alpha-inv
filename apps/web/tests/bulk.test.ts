// Database-backed tests of what a batch upload relies on: several invoices read at the same moment must not
// create the same supplier twice. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const emailFile = process.env.EMAIL_FILE;
if (!ownerUrl || !emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 8).join("\n      ")}`);
  }
}

type Mail = { to: string; subject: string; text: string; html: string };
const mails = (): Mail[] => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail) : []);
let ipCounter = 120;
const ip = () => `203.0.116.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { resolveVendor } = await import("@/lib/invoices/process-upload");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    return org.id;
  };
  const vendors = (orgId: string) => q<{ id: string; name: string; gstin: string | null }>(`SELECT id, name, gstin FROM "Vendor" WHERE "organizationId"=$1 ORDER BY name`, [orgId]);

  const a = await makeCompany("Bulk Alpha", "admin@bulk-alpha.test");
  const b = await makeCompany("Bulk Beta", "admin@bulk-beta.test");

  await check("eight invoices from a NEW supplier (same GSTIN) read at once create one supplier", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => resolveVendor(a, { vendorName: "NEW CEMENT CO", vendorGstin: "27NEWCE1111A1Z5" })));
    assert.equal(new Set(results.map((r) => r.id)).size, 1, "everyone got the same supplier");
    const rows = await vendors(a);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].gstin, "27NEWCE1111A1Z5");
  });

  await check("eight invoices from a new supplier with NO GSTIN create one supplier, not eight", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => resolveVendor(a, { vendorName: "Local Sand", vendorGstin: undefined })));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal((await vendors(a)).filter((v) => v.name === "LOCAL SAND").length, 1);
  });

  await check("different suppliers read at the same time stay separate", async () => {
    const results = await Promise.all([
      resolveVendor(a, { vendorName: "Steel One", vendorGstin: "27STEEL1111A1Z1" }),
      resolveVendor(a, { vendorName: "Steel Two", vendorGstin: "27STEEL2222A1Z2" }),
      resolveVendor(a, { vendorName: "Steel Three", vendorGstin: undefined }),
      resolveVendor(a, { vendorName: "Steel One", vendorGstin: "27STEEL1111A1Z1" }),
    ]);
    assert.equal(new Set(results.map((r) => r.id)).size, 3);
    assert.equal(results[0].id, results[3].id);
  });

  await check("an existing supplier is found by GSTIN, or by name in any letter case, and nothing new is made", async () => {
    const before = (await vendors(a)).length;
    const byGstin = await resolveVendor(a, { vendorName: "A DIFFERENT SPELLING", vendorGstin: "27newce1111a1z5" });
    const byName = await resolveVendor(a, { vendorName: "local sand", vendorGstin: undefined });
    assert.equal(byGstin.name, "NEW CEMENT CO");
    assert.equal(byName.name, "LOCAL SAND");
    assert.equal((await vendors(a)).length, before);
  });

  await check("a missing supplier name becomes UNKNOWN VENDOR, once", async () => {
    const results = await Promise.all([resolveVendor(a, {}), resolveVendor(a, { vendorName: "  " })]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(results[0].name, "UNKNOWN VENDOR");
  });

  await check("another company with the same supplier GSTIN gets its own supplier and never sees the first one's", async () => {
    const mine = await resolveVendor(b, { vendorName: "NEW CEMENT CO", vendorGstin: "27NEWCE1111A1Z5" });
    const [theirs] = await vendors(a).then((rows) => rows.filter((r) => r.gstin === "27NEWCE1111A1Z5"));
    assert.notEqual(mine.id, theirs.id);
    assert.equal((await vendors(b)).length, 1);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
