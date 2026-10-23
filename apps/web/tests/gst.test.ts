// Database-backed tests of the GST report. Run through `npm run test:isolation`.
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
let ipCounter = 80;
const ip = () => `203.0.115.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { loadGstInvoices } = await import("@/lib/gst/load");
  const { buildGstReport, parsePeriod } = await import("@/lib/gst/report");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    return org.id;
  };
  let n = 0;
  const addVendor = async (orgId: string, name: string, gstin: string | null) => {
    const id = `v_gst_${++n}`;
    await q(`INSERT INTO "Vendor"(id,"organizationId",name,gstin) VALUES ($1,$2,$3,$4)`, [id, orgId, name, gstin]);
    return id;
  };
  const addProject = async (orgId: string, name: string) => {
    const id = `p_gst_${++n}`;
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, orgId, name]);
    return id;
  };
  const addInvoice = async (orgId: string, projectId: string, vendorId: string, date: string, sub: number, cgst: number, sgst: number, igst: number, status = "UNPAID") => {
    const id = `i_gst_${++n}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,cgst,sgst,igst,rounding,total,status,"fileUrl","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6::timestamp,$7,$8,$9,$10,0,$11,$12::"InvoiceStatus",'x',now())`,
      [id, orgId, `G-${n}`, projectId, vendorId, `${date}T00:00:00Z`, sub, cgst, sgst, igst, sub + cgst + sgst + igst, status],
    );
    return id;
  };

  const a = await makeCompany("Gst Alpha", "admin@gst-alpha.test");
  const b = await makeCompany("Gst Beta", "admin@gst-beta.test");
  const pa1 = await addProject(a, "Tower One");
  const pa2 = await addProject(a, "Tower Two");
  const va = await addVendor(a, "Cement Co", "27AAAAA0000A1Z5");
  const vNo = await addVendor(a, "Local Supplier", null);
  await addInvoice(a, pa1, va, "2026-04-01", 1000, 90, 90, 0); // first day of FY 2026-27
  await addInvoice(a, pa1, va, "2027-03-31", 2000, 0, 0, 360); // last day
  await addInvoice(a, pa2, vNo, "2026-09-15", 500, 45, 45, 0);
  await addInvoice(a, pa1, va, "2026-03-31", 9999, 900, 900, 0); // previous FY
  await addInvoice(a, pa1, va, "2027-04-01", 9999, 900, 900, 0); // next FY
  await addInvoice(a, pa1, va, "2026-10-01", 7777, 700, 700, 0, "NEEDS_REVIEW"); // draft
  await addInvoice(a, pa1, va, "2026-10-02", 6666, 600, 600, 0, "PROCESSING"); // still reading
  await addInvoice(a, pa1, va, "2026-11-05", 400, 36, 36, 0, "PAID"); // paid ones count
  const vb = await addVendor(b, "Beta Vendor", "29BBBBB1111B1Z6");
  const pb = await addProject(b, "Beta Site");
  await addInvoice(b, pb, vb, "2026-09-15", 123456, 1, 1, 0);

  const fy = parsePeriod({ fy: "2026" }, "2026-10-23");

  await check("the report covers confirmed invoices inside the financial year, first and last day included", async () => {
    const rows = await loadGstInvoices(dbFor(a), fy);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.invoiceDate.toISOString().slice(0, 10)), ["2026-04-01", "2026-09-15", "2026-11-05", "2027-03-31"], "oldest first");
    const r = buildGstReport(rows);
    assert.equal(r.totals.taxableMinor, 390_000);
    assert.equal(r.totals.taxMinor, 18_000 + 9_000 + 7_200 + 36_000);
    assert.equal(r.totals.igstMinor, 36_000);
  });

  await check("drafts waiting for review and invoices still being read are left out; paid ones count", async () => {
    const rows = await loadGstInvoices(dbFor(a), fy);
    assert.ok(!rows.some((r) => r.subtotal === 7777 || r.subtotal === 6666));
    assert.ok(rows.some((r) => r.status === "PAID"));
  });

  await check("a project can be picked, and the supplier's GSTIN comes with each row", async () => {
    const rows = await loadGstInvoices(dbFor(a), fy, pa2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendorName, "Local Supplier");
    assert.equal(rows[0].vendorGstin, null);
    const all = await loadGstInvoices(dbFor(a), fy);
    assert.equal(all.find((r) => r.vendorName === "Cement Co")?.vendorGstin, "27AAAAA0000A1Z5");
  });

  await check("a supplier with tax but no GSTIN is reported", async () => {
    const r = buildGstReport(await loadGstInvoices(dbFor(a), fy));
    assert.deepEqual(r.missingGstin, { count: 1, taxMinor: 9_000 });
    assert.equal(r.mismatched.length, 0);
  });

  await check("a custom date range works and the next year is separate", async () => {
    const sept = await loadGstInvoices(dbFor(a), parsePeriod({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-23"));
    assert.deepEqual(sept.map((r) => r.subtotal), [500]);
    const next = await loadGstInvoices(dbFor(a), parsePeriod({ fy: "2027" }, "2026-10-23"));
    assert.deepEqual(next.map((r) => r.subtotal), [9999]);
  });

  await check("one company's invoices never appear in another company's report", async () => {
    const forB = await loadGstInvoices(dbFor(b), fy);
    assert.deepEqual(forB.map((r) => r.vendorName), ["Beta Vendor"]);
    assert.equal((await loadGstInvoices(dbFor(b), fy, pa1)).length, 0, "Alpha's project id gives nothing under Beta's handle");
    assert.equal((await loadGstInvoices(dbFor(a), fy)).some((r) => r.vendorName === "Beta Vendor"), false);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
