// Database-backed tests of merging duplicate suppliers. Run through `npm run test:isolation`.
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
const ip = () => `198.51.102.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { mergeVendors } = await import("@/lib/flows/vendor-merge");
  const { loadOwed } = await import("@/lib/invoices/planner-load");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,'Merge Project','ACTIVE',now())`, [`p_${row.orgId}`, row.orgId]);
    return { ...row, projectId: `p_${row.orgId}` };
  };
  type Co = Awaited<ReturnType<typeof makeCompany>>;
  let n = 0;
  const addVendor = async (c: Co, name: string, gstin: string | null = null, address: string | null = null, contact: string | null = null) => {
    const id = `v_mg_${++n}`;
    await q(`INSERT INTO "Vendor"(id,"organizationId",name,gstin,address,contact) VALUES ($1,$2,$3,$4,$5,$6)`, [id, c.orgId, name, gstin, address, contact]);
    return id;
  };
  const addInvoice = async (c: Co, vendorId: string, number: string, total = 1000) => {
    const id = `i_mg_${++n}`;
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate","dueDate",subtotal,total,status,"fileUrl","updatedAt") VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,'2026-09-30'::timestamp,$6,$6,'UNPAID','x',now())`, [id, c.orgId, number, c.projectId, vendorId, total]);
    return id;
  };
  const vendorRow = async (id: string) => (await q<{ name: string; gstin: string | null; address: string | null; contact: string | null }>(`SELECT name,gstin,address,contact FROM "Vendor" WHERE id=$1`, [id]))[0];
  const invoiceVendor = async (id: string) => (await q<{ vendorId: string }>(`SELECT "vendorId" FROM "Invoice" WHERE id=$1`, [id]))[0].vendorId;

  const a = await makeCompany("Merge Alpha", "admin@merge-alpha.test");
  const b = await makeCompany("Merge Beta", "admin@merge-beta.test");
  const user = { id: a.userId, orgId: a.orgId };

  await check("merging moves every invoice to the kept supplier, fills in missing details, and removes the other", async () => {
    const keep = await addVendor(a, "Shree Cement Traders", "27AABCS1234F1Z5");
    const dupe = await addVendor(a, "SHREE CEMENT TRADERS PVT LTD", null, "Plot 4, MIDC", "Ravi 98200 00000");
    const i1 = await addInvoice(a, keep, "K-1");
    const i2 = await addInvoice(a, dupe, "D-1");
    const i3 = await addInvoice(a, dupe, "D-2", 500);
    await q(`INSERT INTO "Payment"(id,"organizationId","invoiceId",amount,"paidOn") VALUES ($1,$2,$3,200,'2026-09-10'::timestamp)`, [`pay_mg_${++n}`, a.orgId, i2]);
    const r = await mergeVendors(user, dupe, keep);
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.deepEqual([r.moved, r.keptName, r.removedName], [2, "Shree Cement Traders", "SHREE CEMENT TRADERS PVT LTD"]);
    assert.deepEqual([await invoiceVendor(i1), await invoiceVendor(i2), await invoiceVendor(i3)], [keep, keep, keep]);
    assert.equal((await q(`SELECT 1 FROM "Vendor" WHERE id=$1`, [dupe])).length, 0, "the other supplier is gone");
    const kept = await vendorRow(keep);
    assert.deepEqual([kept.gstin, kept.address, kept.contact], ["27AABCS1234F1Z5", "Plot 4, MIDC", "Ravi 98200 00000"], "kept details stay; blanks are filled in");
    assert.equal((await q(`SELECT 1 FROM "Payment" WHERE "invoiceId"=$1`, [i2])).length, 1, "payments stay with their invoice");
    const owed = await loadOwed(dbFor(a.orgId), {}, "2026-10-23");
    const vendorsOwed = new Set(owed.filter((o) => [i1, i2, i3].includes(o.id)).map((o) => o.vendorName));
    assert.deepEqual([...vendorsOwed], ["Shree Cement Traders"], "everything now shows under one name");
    const [log] = await q<{ details: { removed: { name: string }; invoicesMoved: number; filledIn: string[] } }>(`SELECT details FROM "ActivityLog" WHERE "organizationId"=$1 AND action='VENDOR_MERGED'`, [a.orgId]);
    assert.deepEqual([log.details.removed.name, log.details.invoicesMoved, log.details.filledIn], ["SHREE CEMENT TRADERS PVT LTD", 2, ["address", "contact"]]);
  });

  await check("the GSTIN moves to the kept supplier when it had none (the unique GSTIN does not get in the way)", async () => {
    const keep = await addVendor(a, "Mehta Steel", null, "Kept address");
    const dupe = await addVendor(a, "Mehta Steel and Hardware", "24AAACM9012L1Z8", "Other address");
    await addInvoice(a, dupe, "M-1");
    const r = await mergeVendors(user, dupe, keep);
    assert.ok(r.ok, JSON.stringify(r));
    const kept = await vendorRow(keep);
    assert.deepEqual([kept.gstin, kept.address], ["24AAACM9012L1Z8", "Kept address"]);
  });

  await check("two different GSTINs are refused and nothing changes", async () => {
    const x = await addVendor(a, "Jaquar One", "27AABCJ5678K1Z2");
    const y = await addVendor(a, "Jaquar Two", "29AABCJ5678K1Z9");
    const inv = await addInvoice(a, x, "J-1");
    const r = await mergeVendors(user, x, y);
    assert.deepEqual([r.ok, !r.ok && /different GSTINs/.test(r.error)], [false, true]);
    assert.equal(await invoiceVendor(inv), x);
    assert.equal((await q(`SELECT 1 FROM "Vendor" WHERE id IN ($1,$2)`, [x, y])).length, 2);
  });

  await check("an invoice number both suppliers have (in any letter case) is refused and nothing changes", async () => {
    const x = await addVendor(a, "Sunrise Elec");
    const y = await addVendor(a, "Sunrise Electricals");
    const ix = await addInvoice(a, x, "inv-77");
    const iy = await addInvoice(a, y, "INV-77");
    const r = await mergeVendors(user, x, y);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /numbered inv-77/i);
    assert.deepEqual([await invoiceVendor(ix), await invoiceVendor(iy)], [x, y]);
    assert.equal((await q(`SELECT 1 FROM "Vendor" WHERE id=$1`, [x])).length, 1);
  });

  await check("bad requests: same supplier, missing, unknown, or someone else's supplier", async () => {
    const x = await addVendor(a, "Plain One");
    const theirs = await addVendor(b, "Beta Supplier");
    const theirsInvoice = await addInvoice(b, theirs, "B-1");
    for (const [from, into] of [[x, x], ["", x], [x, ""], [undefined, x], [x, 42], ["nope", x], [x, "nope"], [theirs, x], [x, theirs]] as [unknown, unknown][]) {
      assert.equal((await mergeVendors(user, from, into)).ok, false, `${String(from)} -> ${String(into)}`);
    }
    assert.equal(await invoiceVendor(theirsInvoice), theirs, "the other company's data is untouched");
    assert.equal((await q(`SELECT 1 FROM "Vendor" WHERE id IN ($1,$2)`, [x, theirs])).length, 2);
  });

  await check("the same merge sent twice at once happens once", async () => {
    const keep = await addVendor(a, "Twin Keep");
    const dupe = await addVendor(a, "Twin Keep Ltd");
    const inv = await addInvoice(a, dupe, "T-1");
    const results = await Promise.all([mergeVendors(user, dupe, keep), mergeVendors(user, dupe, keep)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok).length, 1);
    assert.equal(await invoiceVendor(inv), keep);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
