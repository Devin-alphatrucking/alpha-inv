// Database-backed tests of rate alerts: what a company "usually pays". Run through `npm run test:isolation`.
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
let ipCounter = 160;
const ip = () => `203.0.117.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { loadRateBaselines } = await import("@/lib/invoices/rate-baseline");
  const { lineKey, rateAlert } = await import("@/lib/invoices/rate-alerts");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Rate Vendor')`, [`v_${row.orgId}`, row.orgId]);
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,'Rate Project','ACTIVE',now())`, [`p_${row.orgId}`, row.orgId]);
    return { ...row, vendorId: `v_${row.orgId}`, projectId: `p_${row.orgId}` };
  };
  let n = 0;
  type Co = Awaited<ReturnType<typeof makeCompany>>;
  const addInvoice = async (c: Co, date: string, lines: [string, string, number][], status = "UNPAID", uploadedById: string | null = null) => {
    const id = `i_rt_${++n}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","uploadedById","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6::timestamp,100,100,$7::"InvoiceStatus",'x',$8,now())`,
      [id, c.orgId, `RT-${n}`, c.projectId, c.vendorId, `${date}T00:00:00Z`, status, uploadedById],
    );
    for (const [description, unit, rate] of lines) {
      await q(
        `INSERT INTO "InvoiceLineItem"(id,"organizationId","invoiceId",description,quantity,unit,"rateExclGst","gstPercent","gstAmount","lineTotal") VALUES ($1,$2,$3,$4,1,$5,$6,18,0,$6)`,
        [`l_rt_${++n}`, c.orgId, id, description, unit, rate],
      );
    }
    return id;
  };

  const a = await makeCompany("Rate Alpha", "admin@rate-alpha.test");
  const b = await makeCompany("Rate Beta", "admin@rate-beta.test");
  const staffUser = a.userId; // stands in for "someone who uploaded some of the invoices"

  await addInvoice(a, "2026-06-01", [["CEMENT OPC 53", "BAG", 380], ["STEEL TMT", "KG", 60]]);
  await addInvoice(a, "2026-07-01", [["CEMENT OPC 53", "BAG", 400], ["STEEL TMT", "KG", 62]]);
  await addInvoice(a, "2026-08-01", [["Cement OPC 53", "bag", 420]]); // other letter case still counts
  await addInvoice(a, "2026-09-01", [["CEMENT OPC 53", "BAG", 5000]], "NEEDS_REVIEW"); // a draft never sets the usual
  await addInvoice(a, "2026-09-02", [["CEMENT OPC 53", "KG", 9]]); // another unit is another item
  await addInvoice(b, "2026-06-01", [["CEMENT OPC 53", "BAG", 100], ["CEMENT OPC 53", "BAG", 100], ["CEMENT OPC 53", "BAG", 100]]);
  const current = await addInvoice(a, "2026-10-01", [["CEMENT OPC 53", "BAG", 900]], "NEEDS_REVIEW"); // the invoice being reviewed

  const lines = [{ description: "CEMENT OPC 53", unit: "BAG" }, { description: "STEEL TMT", unit: "KG" }];
  const key = lineKey("CEMENT OPC 53", "BAG");

  await check("the usual rate comes from confirmed earlier invoices: same item and unit, any letter case, drafts and the invoice itself left out", async () => {
    const map = await loadRateBaselines(dbFor(a.orgId), current, lines);
    const cement = map.get(key)!;
    assert.equal(cement.usual, 400);
    assert.equal(cement.count, 3);
    assert.equal(cement.lastRate, 420);
    assert.equal(cement.lastDate, "2026-08-01");
    assert.equal(cement.lastVendor, "Rate Vendor");
  });

  await check("an item with fewer than three earlier purchases gets no baseline, so no alert", async () => {
    const map = await loadRateBaselines(dbFor(a.orgId), current, lines);
    assert.equal(map.has(lineKey("STEEL TMT", "KG")), false);
    const kg = await loadRateBaselines(dbFor(a.orgId), current, [{ description: "CEMENT OPC 53", unit: "KG" }]);
    assert.equal(kg.size, 0, "one purchase in KG is not enough, and the BAG history is not mixed in");
  });

  await check("the alert fires on the typed rate: 900 against a usual 400 is far above, 440 is fine", async () => {
    const cement = (await loadRateBaselines(dbFor(a.orgId), current, lines)).get(key)!;
    assert.deepEqual(rateAlert(900, cement), { level: "very-high", percent: 125, usual: 400 });
    assert.equal(rateAlert(440, cement), null);
    assert.equal(rateAlert(470, cement)!.level, "high");
  });

  await check("a person who can only see some invoices is judged only against those", async () => {
    const own = await addInvoice(a, "2026-05-01", [["BRICKS", "NOS", 8]], "UNPAID", staffUser);
    await addInvoice(a, "2026-05-02", [["BRICKS", "NOS", 9]], "UNPAID", staffUser);
    await addInvoice(a, "2026-05-03", [["BRICKS", "NOS", 10]], "UNPAID", staffUser);
    await addInvoice(a, "2026-05-04", [["BRICKS", "NOS", 50]]); // someone else's, on another person's upload
    const brick = [{ description: "BRICKS", unit: "NOS" }];
    const all = await loadRateBaselines(dbFor(a.orgId), current, brick);
    const mine = await loadRateBaselines(dbFor(a.orgId), current, brick, { uploadedById: staffUser });
    assert.equal(all.get(lineKey("BRICKS", "NOS"))!.count, 4);
    assert.equal(mine.get(lineKey("BRICKS", "NOS"))!.count, 3);
    assert.equal(mine.get(lineKey("BRICKS", "NOS"))!.usual, 9);
    assert.ok(own);
  });

  await check("another company's prices never count", async () => {
    const forB = await loadRateBaselines(dbFor(b.orgId), "none", [{ description: "CEMENT OPC 53", unit: "BAG" }]);
    assert.equal(forB.get(key)!.usual, 100);
    assert.equal(forB.get(key)!.count, 3);
    const stillA = await loadRateBaselines(dbFor(a.orgId), current, lines);
    assert.equal(stillA.get(key)!.usual, 400);
  });

  await check("blank descriptions and an empty list are harmless", async () => {
    assert.equal((await loadRateBaselines(dbFor(a.orgId), current, [])).size, 0);
    assert.equal((await loadRateBaselines(dbFor(a.orgId), current, [{ description: "   ", unit: "BAG" }])).size, 0);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
