// Database-backed tests of project budgets. Run through `npm run test:isolation`.
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
let ipCounter = 40;
const ip = () => `203.0.114.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { loadBudgetAlerts, projectSpend } = await import("@/lib/projects/budget-alerts");
  const { sendDailyDigests } = await import("@/lib/flows/digest");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`UPDATE "Organization" SET timezone='UTC' WHERE id=$1`, [org.id]);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Budget Vendor')`, [`v_${org.id}`, org.id]);
    return { orgId: org.id, email };
  };
  let n = 0;
  const addProject = async (orgId: string, name: string, budget: number | null, status = "ACTIVE") => {
    const id = `p_bg_${++n}_${orgId.slice(-4)}`;
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,budget,"updatedAt") VALUES ($1,$2,$3,$4::"ProjectStatus",$5,now())`, [id, orgId, name, status, budget]);
    return id;
  };
  const addInvoice = async (orgId: string, projectId: string, total: number, status = "UNPAID") => {
    const id = `i_bg_${++n}_${orgId.slice(-4)}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,sgst,cgst,igst,rounding,total,status,"fileUrl","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,$6,0,0,0,0,$6,$7::"InvoiceStatus",'x',now())`,
      [id, orgId, `BG-${n}`, projectId, `v_${orgId}`, total, status],
    );
  };

  const a = await makeCompany("Budget Alpha", "admin@budget-alpha.test");
  const b = await makeCompany("Budget Beta", "admin@budget-beta.test");

  const pOk = await addProject(a.orgId, "Fine Project", 100000);
  const pWarn = await addProject(a.orgId, "Warning Project", 100000);
  const pOver = await addProject(a.orgId, "Over Project", 100000);
  const pNone = await addProject(a.orgId, "No Budget Project", null);
  const pDone = await addProject(a.orgId, "Finished Project", 1000, "COMPLETED");
  await addInvoice(a.orgId, pOk, 20000);
  await addInvoice(a.orgId, pWarn, 50000);
  await addInvoice(a.orgId, pWarn, 35000, "PAID"); // paid invoices count: spend is what was bought, not what is still owed
  await addInvoice(a.orgId, pOver, 120000);
  await addInvoice(a.orgId, pOver, 999999, "NEEDS_REVIEW"); // a draft is not counted yet
  await addInvoice(a.orgId, pNone, 500000);
  await addInvoice(a.orgId, pDone, 5000);
  const pBeta = await addProject(b.orgId, "Beta Project", 10);
  await addInvoice(b.orgId, pBeta, 999);

  await check("spend is the total of CONFIRMED invoices per project (paid ones count, drafts do not)", async () => {
    const spend = await projectSpend(dbFor(a.orgId), [pOk, pWarn, pOver, pNone]);
    assert.equal(spend.get(pOk), 20000);
    assert.equal(spend.get(pWarn), 85000);
    assert.equal(spend.get(pOver), 120000, "the 999,999 draft is ignored");
    assert.equal(spend.get(pNone), 500000);
    assert.equal((await projectSpend(dbFor(a.orgId), [])).size, 0);
  });

  await check("alerts: over budget first, then warnings; fine, no-budget and finished projects are left out", async () => {
    const alerts = await loadBudgetAlerts(dbFor(a.orgId));
    assert.deepEqual(alerts.map((x) => x.name), ["Over Project", "Warning Project"]);
    assert.deepEqual(alerts.map((x) => x.level), ["over", "warn"]);
    assert.equal(alerts[0].percent, 120);
    assert.equal(alerts[1].percent, 85);
    assert.equal(alerts[1].spentMinor, 8_500_000);
    assert.equal(alerts[1].budgetMinor, 10_000_000);
  });

  await check("alerts can be limited to some projects (one selected project, or a staff member's assigned ones)", async () => {
    assert.deepEqual((await loadBudgetAlerts(dbFor(a.orgId), { id: pWarn })).map((x) => x.name), ["Warning Project"]);
    assert.deepEqual(await loadBudgetAlerts(dbFor(a.orgId), { id: pOk }), []);
    assert.deepEqual(await loadBudgetAlerts(dbFor(a.orgId), { id: { in: [] } }), []);
  });

  await check("one company's budgets and spend never show up for another company", async () => {
    const forB = await loadBudgetAlerts(dbFor(b.orgId));
    assert.deepEqual(forB.map((x) => x.name), ["Beta Project"]);
    assert.equal((await projectSpend(dbFor(b.orgId), [pOver])).size, 0, "Alpha's project id gives nothing under Beta's handle");
  });

  await check("a budget is stored with cents and cleared with null", async () => {
    await q(`UPDATE "Project" SET budget = 2500000.5 WHERE id=$1`, [pOk]);
    const [row] = await q<{ budget: string }>(`SELECT budget::text FROM "Project" WHERE id=$1`, [pOk]);
    assert.equal(row.budget, "2500000.50");
    await q(`UPDATE "Project" SET budget = NULL WHERE id=$1`, [pOk]);
    assert.deepEqual(await loadBudgetAlerts(dbFor(a.orgId), { id: pOk }), []);
  });

  await check("the daily email lists the budget alerts, even when nothing else needs attention", async () => {
    const run = await sendDailyDigests({ now: new Date("2026-10-23T09:00:00Z"), hour: 8 });
    assert.ok(run.sent >= 1, JSON.stringify(run));
    const mail = mails().filter((m) => m.to === a.email && /budget/i.test(m.subject)).at(-1);
    assert.ok(mail, "an email with a budget subject was sent");
    assert.match(mail.subject, /1 project over budget/);
    assert.match(mail.text, /Budget alerts:/);
    assert.match(mail.text, /Over Project: .* of .* \(120%, over budget\)/);
    assert.match(mail.text, /Warning Project: .* \(85%\)/);
    assert.ok(!mail.text.includes("Fine Project") && !mail.text.includes("No Budget Project") && !mail.text.includes("Finished Project"));
    assert.ok(!mail.text.includes("Beta Project"), "another company's budget never appears");
    assert.match(mail.html, /Budget alerts/);
  });

  await check("a company whose only news is a budget alert still gets the email; one with a fine budget gets none", async () => {
    const c = await makeCompany("Budget Gamma", "admin@budget-gamma.test");
    const p = await addProject(c.orgId, "Gamma Project", 1000);
    await addInvoice(c.orgId, p, 100, "PAID");
    await sendDailyDigests({ now: new Date("2026-10-24T09:00:00Z"), hour: 8 });
    assert.equal(mails().filter((m) => m.to === c.email && /budget|summary/i.test(m.subject)).length, 0, "10% of the budget: nothing to report");
    await addInvoice(c.orgId, p, 800, "PAID"); // now 90%
    await sendDailyDigests({ now: new Date("2026-10-25T09:00:00Z"), hour: 8 });
    const m = mails().filter((x) => x.to === c.email).at(-1);
    assert.ok(m && /1 project near budget/.test(m.subject), m?.subject);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
