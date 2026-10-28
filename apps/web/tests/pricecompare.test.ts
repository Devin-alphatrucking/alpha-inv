// Database-backed tests of the supplier price comparison. Run through `npm run test:isolation`.
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
const ip = () => `198.51.103.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { loadPurchaseLines } = await import("@/lib/invoices/price-compare-load");
  const { comparePrices, sinceDate } = await import("@/lib/invoices/price-compare");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string }>(`SELECT o.id AS "orgId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,'P One','ACTIVE',now()), ($3,$2,'P Two','ACTIVE',now())`, [`p1_${row.orgId}`, row.orgId, `p2_${row.orgId}`]);
    return { ...row, p1: `p1_${row.orgId}`, p2: `p2_${row.orgId}` };
  };
  type Co = Awaited<ReturnType<typeof makeCompany>>;
  let n = 0;
  const addVendor = async (c: Co, name: string) => {
    const id = `v_pc_${++n}`;
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,$3)`, [id, c.orgId, name]);
    return id;
  };
  const addPurchase = async (c: Co, vendorId: string, date: string, lines: [string, string, number, number][], status = "UNPAID", projectId = c.p1) => {
    const id = `i_pc_${++n}`;
    await q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamp,100,100,$7::"InvoiceStatus",'x',now())`, [id, c.orgId, `PC-${n}`, projectId, vendorId, `${date}T00:00:00Z`, status]);
    for (const [description, unit, rate, quantity] of lines) {
      await q(`INSERT INTO "InvoiceLineItem"(id,"organizationId","invoiceId",description,quantity,unit,"rateExclGst","gstPercent","gstAmount","lineTotal") VALUES ($1,$2,$3,$4,$5,$6,$7,18,0,$7)`, [`l_pc_${++n}`, c.orgId, id, description, quantity, unit, rate]);
    }
  };

  const a = await makeCompany("Price Alpha", "admin@price-alpha.test");
  const b = await makeCompany("Price Beta", "admin@price-beta.test");
  const vA = await addVendor(a, "Cement Co");
  const vB = await addVendor(a, "Budget Cement");
  const vC = await addVendor(a, "Steel Co");
  const vBeta = await addVendor(b, "Beta Cement");

  await addPurchase(a, vA, "2026-09-01", [["Cement OPC 53", "BAG", 400, 100], ["Steel TMT", "KG", 60, 1000]]);
  await addPurchase(a, vB, "2026-09-10", [["CEMENT OPC-53", "bag", 380, 200]]); // other spelling, same item
  await addPurchase(a, vC, "2026-09-12", [["Steel TMT", "KG", 66, 500]]);
  await addPurchase(a, vA, "2026-02-01", [["Cement OPC 53", "BAG", 300, 100]]); // old: outside a 6-month look-back
  await addPurchase(a, vB, "2026-09-15", [["Cement OPC 53", "BAG", 100, 1000]], "NEEDS_REVIEW"); // a draft does not count
  await addPurchase(a, vB, "2026-09-16", [["Cement OPC 53", "BAG", 100, 1000]], "PROCESSING");
  await addPurchase(a, vA, "2026-09-20", [["Cement OPC 53", "BAG", 410, 50]], "UNPAID", a.p2); // other project
  await addPurchase(b, vBeta, "2026-09-01", [["Cement OPC 53", "BAG", 1, 1]]);
  await addPurchase(b, await addVendor(b, "Beta Two"), "2026-09-02", [["Cement OPC 53", "BAG", 9, 1]]);

  const since6 = sinceDate("2026-10-23", 6);

  await check("purchase lines come from confirmed invoices in the period only", async () => {
    const { lines, capped } = await loadPurchaseLines(dbFor(a.orgId), { since: since6 });
    assert.equal(capped, false);
    assert.equal(lines.length, 5, "the old purchase, the two drafts and the other company are out");
    assert.ok(!lines.some((l) => l.rate === 100 || l.rate === 300 || l.rate === 1 || l.rate === 9));
    const all = await loadPurchaseLines(dbFor(a.orgId), { since: "2025-01-01" });
    assert.equal(all.lines.length, 6, "a longer look-back adds the old purchase");
  });

  await check("the comparison finds the cheaper supplier and what was overpaid", async () => {
    const { lines } = await loadPurchaseLines(dbFor(a.orgId), { since: since6 });
    const items = comparePrices(lines);
    assert.equal(items.length, 2, "cement and steel were each bought from two suppliers");
    const cement = items.find((i) => /cement/i.test(i.description))!;
    assert.equal(cement.suppliers.length, 2, "the two spellings are one item");
    assert.equal(cement.cheapestId, vB);
    const [cheap, dear] = cement.suppliers;
    assert.deepEqual([cheap.avgRate, cheap.quantity], [380, 200]);
    assert.equal(dear.vendorId, vA);
    assert.equal(dear.avgRate, 403.33, "(400x100 + 410x50) / 150, quantity-weighted");
    assert.equal(dear.extraPaid, 3500, "150 bags x (403.33 - 380)");
    const steel = items.find((i) => /steel/i.test(i.description))!;
    assert.equal(steel.cheapestId, vA);
    assert.equal(steel.potentialSaving, 3000);
    assert.deepEqual(items.map((i) => i.potentialSaving), [3500, 3000], "biggest saving first");
  });

  await check("one project can be compared on its own", async () => {
    const { lines } = await loadPurchaseLines(dbFor(a.orgId), { since: since6, projectId: a.p2 });
    assert.equal(lines.length, 1);
    assert.deepEqual(comparePrices(lines), [], "one supplier in that project: nothing to compare");
    const p1 = await loadPurchaseLines(dbFor(a.orgId), { since: since6, projectId: a.p1 });
    assert.equal(p1.lines.length, 4);
  });

  await check("another company's purchases never show up", async () => {
    const forB = await loadPurchaseLines(dbFor(b.orgId), { since: since6 });
    assert.equal(forB.lines.length, 2);
    assert.ok(forB.lines.every((l) => l.vendorName.startsWith("Beta")));
    const cross = await loadPurchaseLines(dbFor(b.orgId), { since: since6, projectId: a.p1 });
    assert.equal(cross.lines.length, 0, "Alpha's project id gives nothing under Beta's handle");
    const beta = comparePrices(forB.lines);
    assert.equal(beta.length, 1);
    assert.equal(beta[0].suppliers.length, 2);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
