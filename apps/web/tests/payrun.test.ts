// Database-backed tests of the payment planner: what is owed, and recording a pay run. Run through `npm run test:isolation`.
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
const ip = () => `198.51.101.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { recordPayRun } = await import("@/lib/flows/pay-run");
  const { loadOwed } = await import("@/lib/invoices/planner-load");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { todayIn } = await import("@/lib/invoices/status");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string; tz: string }>(`SELECT o.id AS "orgId", u.id AS "userId", o.timezone AS tz FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Run Vendor')`, [`v_${row.orgId}`, row.orgId]);
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,'Run Project','ACTIVE',now())`, [`p_${row.orgId}`, row.orgId]);
    return { ...row, vendorId: `v_${row.orgId}`, projectId: `p_${row.orgId}` };
  };
  type Co = Awaited<ReturnType<typeof makeCompany>>;
  let n = 0;
  const addInvoice = async (c: Co, total: number, due: string | null, status = "UNPAID", paid = 0, uploadedById: string | null = null) => {
    const id = `i_pr_${++n}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate","dueDate",subtotal,total,status,"fileUrl","uploadedById","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,$6,$7,$7,$8::"InvoiceStatus",'x',$9,now())`,
      [id, c.orgId, `PR-${n}`, c.projectId, c.vendorId, due ? `${due}T00:00:00Z` : null, total, status, uploadedById],
    );
    if (paid > 0) await q(`INSERT INTO "Payment"(id,"organizationId","invoiceId",amount,"paidOn") VALUES ($1,$2,$3,$4,'2026-09-15'::timestamp)`, [`pay_pr_${++n}`, c.orgId, id, paid]);
    return id;
  };
  const payments = (invoiceId: string) => q<{ amount: string; mode: string | null; reference: string | null; paidOn: string; notes: string | null }>(`SELECT amount::text, mode, reference, "paidOn"::date::text AS "paidOn", notes FROM "Payment" WHERE "invoiceId"=$1 ORDER BY "createdAt"`, [invoiceId]);
  const statusOf = async (id: string) => (await q<{ status: string; paidAt: Date | null }>(`SELECT status, "paidAt" FROM "Invoice" WHERE id=$1`, [id]))[0];

  const a = await makeCompany("Run Alpha", "admin@run-alpha.test");
  const b = await makeCompany("Run Beta", "admin@run-beta.test");
  const admin = { id: a.userId, orgId: a.orgId, role: "ADMIN" as const };
  const today = todayIn(a.tz);
  // Dates are counted from the company's own calendar day (a clock in India is a day ahead of UTC for part of every day).
  const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const past = (days: number) => shift(-days);
  const ahead = (days: number) => shift(days);

  const late = await addInvoice(a, 1000, past(10), "OVERDUE");
  const soon = await addInvoice(a, 500, ahead(3));
  const partly = await addInvoice(a, 300, ahead(20), "PARTIALLY_PAID", 100);
  const settled = await addInvoice(a, 400, ahead(5), "PAID", 400);
  const draft = await addInvoice(a, 999, ahead(5), "NEEDS_REVIEW");
  const noDue = await addInvoice(a, 250, null);
  const betaInvoice = await addInvoice(b, 777, ahead(2));

  await check("what is owed: confirmed invoices with a balance, most overdue first, no due date last; drafts, settled and other companies left out", async () => {
    const owed = await loadOwed(dbFor(a.orgId), {}, today);
    assert.deepEqual(owed.map((o) => o.id), [late, soon, partly, noDue]);
    assert.deepEqual(owed.map((o) => o.balanceMinor), [100_000, 50_000, 20_000, 25_000], "the part payment is taken off");
    assert.equal(owed[0].daysLate, 10);
    assert.ok(!owed.some((o) => [settled, draft, betaInvoice].includes(o.id)));
    assert.deepEqual((await loadOwed(dbFor(a.orgId), { projectId: "nothing" }, today)), []);
  });

  await check("a pay run records every payment with the date, mode and reference, and updates each status", async () => {
    const r = await recordPayRun(admin, { items: [{ invoiceId: late, amount: 1000 }, { invoiceId: soon, amount: 200 }, { invoiceId: partly, amount: 200 }], paidOn: today, mode: "UPI", reference: "RUN-1" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual([r.paid, r.failed, r.totalMinor], [3, 0, 140_000]);
    assert.deepEqual(r.lines.map((l) => [l.invoiceNumber, l.ok, l.status]), [["PR-1", true, "PAID"], ["PR-2", true, "PARTIALLY_PAID"], ["PR-3", true, "PAID"]]);
    const [p] = await payments(late);
    assert.deepEqual([p.amount, p.mode, p.reference, p.notes], ["1000.00", "UPI", "RUN-1", "Paid in a payment run"]);
    assert.equal(p.paidOn, today);
    assert.equal((await statusOf(late)).status, "PAID");
    assert.ok((await statusOf(late)).paidAt, "paid in full records when");
    assert.equal((await statusOf(soon)).status, "PARTIALLY_PAID");
    assert.equal((await statusOf(partly)).status, "PAID");
    assert.equal((await payments(partly)).length, 2, "the earlier part payment is kept");
  });

  await check("the run and each payment are written to the activity log", async () => {
    const rows = await q<{ action: string; details: Record<string, unknown> }>(`SELECT action, details FROM "ActivityLog" WHERE "organizationId"=$1 AND action IN ('PAY_RUN_RECORDED','PAYMENT_CREATED')`, [a.orgId]);
    assert.equal(rows.filter((r) => r.action === "PAYMENT_CREATED").length, 3);
    const run = rows.find((r) => r.action === "PAY_RUN_RECORDED")!;
    assert.deepEqual([run.details.requested, run.details.paid, run.details.failed, run.details.totalMinor, run.details.reference], [3, 3, 0, 140_000, "RUN-1"]);
  });

  await check("one bill that cannot be paid is reported on its own line and the others still go through", async () => {
    const x = await addInvoice(a, 100, ahead(1));
    const y = await addInvoice(a, 100, ahead(1));
    const r = await recordPayRun(admin, { items: [{ invoiceId: x, amount: 100 }, { invoiceId: settled, amount: 50 }, { invoiceId: draft, amount: 10 }, { invoiceId: y, amount: 150 }, { invoiceId: "no-such-invoice", amount: 5 }], paidOn: today, mode: "Cash", reference: "RUN-2" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.lines.map((l) => l.ok), [true, false, false, false, false]);
    assert.match(r.lines[1].error!, /cannot exceed/, "already settled");
    assert.match(r.lines[2].error!, /confirmed invoices/, "a draft is not payable");
    assert.match(r.lines[3].error!, /cannot exceed/, "more than the balance");
    assert.match(r.lines[4].error!, /not found/i);
    assert.deepEqual([r.paid, r.failed, r.totalMinor], [1, 4, 10_000]);
    assert.equal((await payments(settled)).length, 1, "nothing was added to the settled invoice");
    assert.equal((await payments(y)).length, 0, "an over-large amount saves nothing at all");
  });

  await check("the identical run submitted twice at once pays only once", async () => {
    const z = await addInvoice(a, 600, ahead(4));
    const run = { items: [{ invoiceId: z, amount: 100 }], paidOn: today, mode: "Bank transfer", reference: "DOUBLE" };
    const [first, second] = await Promise.all([recordPayRun(admin, run), recordPayRun(admin, run)]);
    const oks = [first, second].filter((r) => r.ok);
    assert.equal(oks.length, 1, "exactly one was accepted");
    const refused = [first, second].find((r) => !r.ok)!;
    assert.match(!refused.ok ? refused.error : "", /just submitted/);
    assert.equal((await payments(z)).length, 1);
    const different = await recordPayRun(admin, { ...run, items: [{ invoiceId: z, amount: 150 }] });
    assert.ok(different.ok, "a different run straight after is fine");
    assert.equal((await payments(z)).length, 2);
  });

  await check("a run with bad input is refused as a whole and nothing is saved", async () => {
    const w = await addInvoice(a, 300, ahead(4));
    const bad = [
      { items: [], paidOn: today },
      { items: [{ invoiceId: w, amount: 50 }, { invoiceId: w, amount: 60 }], paidOn: today },
      { items: [{ invoiceId: w, amount: 0 }], paidOn: today },
      { items: [{ invoiceId: w, amount: 50 }], paidOn: ahead(3) },
      { items: [{ invoiceId: w, amount: 50 }], paidOn: "yesterday" },
      { items: [{ invoiceId: w, amount: 50 }], paidOn: today, reference: "x".repeat(101) },
    ];
    for (const input of bad) assert.equal((await recordPayRun(admin, input)).ok, false, JSON.stringify(input).slice(0, 80));
    assert.equal((await payments(w)).length, 0);
  });

  await check("staff are limited to invoices they can see, and another company's invoice cannot be paid", async () => {
    const staffId = "u_pr_staff";
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,'Run Staff','staff@run-alpha.test','x',now(),now())`, [staffId]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_pr_staff',$1,$2,'STAFF')`, [staffId, a.orgId]);
    const theirs = await addInvoice(a, 100, ahead(2), "UNPAID", 0, staffId);
    const notTheirs = await addInvoice(a, 100, ahead(2));
    const staff = { id: staffId, orgId: a.orgId, role: "STAFF" as const };
    const r = await recordPayRun(staff, { items: [{ invoiceId: theirs, amount: 100 }, { invoiceId: notTheirs, amount: 100 }], paidOn: today, mode: "Cash", reference: "STAFF-RUN" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.lines.map((l) => l.ok), [true, false]);
    assert.equal((await payments(notTheirs)).length, 0);
    const cross = await recordPayRun(admin, { items: [{ invoiceId: betaInvoice, amount: 77 }], paidOn: today, mode: "Cash", reference: "CROSS" });
    assert.ok(cross.ok);
    if (cross.ok) assert.equal(cross.paid, 0);
    assert.equal((await payments(betaInvoice)).length, 0, "Beta's invoice is untouched");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
