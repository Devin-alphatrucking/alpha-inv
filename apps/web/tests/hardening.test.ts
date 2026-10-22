// Database-backed tests for the bug-fix round (payments, overdue, access). Run through `npm run test:isolation`.
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
async function rejects(promise: Promise<unknown>, match?: RegExp) {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, "expected the call to fail, but it succeeded");
  if (match) assert.match(String((error as Error).message), match);
  return error as Error & { code?: string };
}

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 80;
const ip = () => `203.0.113.${++ipCounter}`;
const day = 86_400_000;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { recordPayment } = await import("@/lib/invoices/payments");
  const { syncOverdue } = await import("@/lib/invoices/overdue");
  const { assertInvoiceAccess } = await import("@/lib/invoices/access");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    const [user] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    const [project] = await q<{ id: string }>(`SELECT id FROM "Project" WHERE "organizationId"=$1 LIMIT 1`, [org.id]);
    const [vendorRow] = await q<{ id: string }>(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Test Vendor') RETURNING id`, [`v_${org.id}`, org.id]);
    return { orgId: org.id, admin: { id: user.id, orgId: org.id, role: "ADMIN" as const }, projectId: project.id, vendorId: vendorRow.id };
  };
  let n = 0;
  const addInvoice = async (c: Awaited<ReturnType<typeof makeCompany>>, total: number, o: { status?: string; dueInDays?: number | null } = {}) => {
    const id = `inv_h_${++n}_${c.orgId.slice(-4)}`;
    const due = o.dueInDays === null ? null : `(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '${o.dueInDays ?? 30} days')`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate","dueDate",subtotal,sgst,cgst,igst,rounding,total,status,"fileUrl","updatedAt")
       VALUES ($1,$2,$3,$4,$5,date_trunc('day', now() AT TIME ZONE 'UTC'), ${due ?? "NULL"},$6,0,0,0,0,$6,$7::"InvoiceStatus",'x',now())`,
      [id, c.orgId, `H-${n}`, c.projectId, c.vendorId, total, o.status ?? "UNPAID"],
    );
    return id;
  };
  const inv = async (id: string) => (await q<{ status: string; paidAt: Date | null }>(`SELECT status, "paidAt" FROM "Invoice" WHERE id=$1`, [id]))[0];
  const paidSum = async (id: string) => Number((await q<{ s: string }>(`SELECT COALESCE(sum(amount),0) s FROM "Payment" WHERE "invoiceId"=$1`, [id]))[0].s);
  const today = new Date().toISOString().slice(0, 10);

  const a = await makeCompany("Hardening A", "admin@hardening-a.test");
  const b = await makeCompany("Hardening B", "admin@hardening-b.test");
  await q(`UPDATE "Organization" SET timezone='UTC' WHERE id = ANY($1)`, [[a.orgId, b.orgId]]);

  // ------------------------------------------------------------------ payments
  await check("8 simultaneous payments of the full amount: exactly one is accepted, the total is never exceeded", async () => {
    const id = await addInvoice(a, 1000);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => recordPayment(a.admin, { invoiceId: id, amount: 1000, paidOn: today })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok.length, 1, `accepted ${ok.length}`);
    assert.ok(refused.every((r) => /cannot exceed the remaining balance/.test(String(r.reason?.message))), refused.map((r) => r.reason?.message).join(" | "));
    assert.equal(await paidSum(id), 1000);
    assert.equal((await inv(id)).status, "PAID");
  });

  await check("two simultaneous partial payments that together settle the invoice leave it PAID (not 'partially paid')", async () => {
    const id = await addInvoice(a, 1000);
    const [x, y] = await Promise.all([
      recordPayment(a.admin, { invoiceId: id, amount: 500, paidOn: today }),
      recordPayment(a.admin, { invoiceId: id, amount: 500, paidOn: today }),
    ]);
    assert.ok(x.paymentId && y.paymentId);
    assert.equal(await paidSum(id), 1000);
    assert.equal((await inv(id)).status, "PAID");
  });

  await check("status follows the money: part paid, then paid in full; fully-paid date is the LATEST payment date", async () => {
    const id = await addInvoice(a, 1000);
    const early = new Date(Date.now() - 10 * day).toISOString().slice(0, 10);
    const r1 = await recordPayment(a.admin, { invoiceId: id, amount: 400, paidOn: today });
    assert.equal(r1.status, "PARTIALLY_PAID");
    assert.equal(r1.balance, 600);
    const r2 = await recordPayment(a.admin, { invoiceId: id, amount: 600, paidOn: early }); // entered last, but dated earlier
    assert.equal(r2.status, "PAID");
    const [row] = await q<{ d: string }>(`SELECT to_char("paidAt", 'YYYY-MM-DD') d FROM "Invoice" WHERE id=$1`, [id]);
    assert.equal(row.d, today, "paid at the latest payment date, not the last one entered");
  });

  await check("a part-paid invoice that is past its due date is OVERDUE, and paying the rest makes it PAID", async () => {
    const id = await addInvoice(a, 1000, { dueInDays: -3 });
    const r = await recordPayment(a.admin, { invoiceId: id, amount: 300, paidOn: today });
    assert.equal(r.status, "OVERDUE");
    assert.equal((await recordPayment(a.admin, { invoiceId: id, amount: 700, paidOn: today })).status, "PAID");
  });

  await check("cents never break the balance: 0.10 + 0.20 settles a 0.30 invoice", async () => {
    const id = await addInvoice(a, 0.3);
    assert.equal((await recordPayment(a.admin, { invoiceId: id, amount: 0.1, paidOn: today })).status, "PARTIALLY_PAID");
    assert.equal((await recordPayment(a.admin, { invoiceId: id, amount: 0.2, paidOn: today })).status, "PAID");
  });

  await check("refused: more than the balance, zero or negative amounts, a bad date, and a draft invoice", async () => {
    const id = await addInvoice(a, 100);
    await rejects(recordPayment(a.admin, { invoiceId: id, amount: 100.01, paidOn: today }), /cannot exceed/);
    await rejects(recordPayment(a.admin, { invoiceId: id, amount: 0, paidOn: today }), /invalid/i);
    await rejects(recordPayment(a.admin, { invoiceId: id, amount: -5, paidOn: today }), /invalid/i);
    await rejects(recordPayment(a.admin, { invoiceId: id, amount: 10, paidOn: "not a date" }), /date/i);
    const draft = await addInvoice(a, 100, { status: "NEEDS_REVIEW" });
    await rejects(recordPayment(a.admin, { invoiceId: draft, amount: 10, paidOn: today }), /Finish review/);
    assert.equal(await paidSum(id), 0);
    assert.equal(await paidSum(draft), 0);
  });

  await check("a payment cannot touch another company's invoice, and the refusal is a normal 'not found' error", async () => {
    const id = await addInvoice(b, 500);
    const e = await rejects(recordPayment(a.admin, { invoiceId: id, amount: 10, paidOn: today }), /not found/i);
    assert.equal((e as { code?: string }).code, "NOT_FOUND_001");
    assert.equal(await paidSum(id), 0);
    const e2 = await rejects(assertInvoiceAccess(id, a.admin), /not found/i);
    assert.equal((e2 as { code?: string }).code, "NOT_FOUND_001");
  });

  await check("staff who are not on the project cannot pay its invoices", async () => {
    const id = await addInvoice(a, 500);
    const [u] = await q<{ id: string }>(`INSERT INTO "User"(id,name,email,"passwordHash",role,"updatedAt") VALUES ('u_staff_h','Staff H','staff@hardening-a.test','x','STAFF',now()) RETURNING id`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_staff_h',$1,$2,'STAFF')`, [u.id, a.orgId]);
    const staff = { id: u.id, orgId: a.orgId, role: "STAFF" as const };
    await rejects(recordPayment(staff, { invoiceId: id, amount: 10, paidOn: today }), /not found|access/i);
    await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","projectId","userId") VALUES ('pa_staff_h',$1,$2,$3)`, [a.orgId, a.projectId, u.id]);
    assert.ok((await recordPayment(staff, { invoiceId: id, amount: 10, paidOn: today })).paymentId);
  });

  // ------------------------------------------------------------------ overdue
  await check("overdue sweep: unpaid and part-paid invoices past their due DAY become OVERDUE; due today and paid ones do not", async () => {
    const late = await addInvoice(a, 100, { dueInDays: -2 });
    const latePart = await addInvoice(a, 100, { status: "PARTIALLY_PAID", dueInDays: -1 });
    const dueToday = await addInvoice(a, 100, { dueInDays: 0 });
    const future = await addInvoice(a, 100, { dueInDays: 5 });
    const paid = await addInvoice(a, 100, { status: "PAID", dueInDays: -10 });
    const noDue = await addInvoice(a, 100, { dueInDays: null });
    const draft = await addInvoice(a, 100, { status: "NEEDS_REVIEW", dueInDays: -10 });
    const otherCompany = await addInvoice(b, 100, { dueInDays: -9 });

    const changed = await syncOverdue(a.orgId, { force: true });
    assert.ok(changed >= 2, `changed ${changed}`);
    const s = async (id: string) => (await inv(id)).status;
    assert.equal(await s(late), "OVERDUE");
    assert.equal(await s(latePart), "OVERDUE");
    assert.equal(await s(dueToday), "UNPAID", "due today is not overdue yet");
    assert.equal(await s(future), "UNPAID");
    assert.equal(await s(paid), "PAID");
    assert.equal(await s(noDue), "UNPAID");
    assert.equal(await s(draft), "NEEDS_REVIEW", "drafts are not confirmed invoices");
    assert.equal(await s(otherCompany), "UNPAID", "another company is untouched by this company's sweep");
  });

  await check("overdue sweep: respects the company time zone, and runs at most once per few minutes unless forced", async () => {
    const id = await addInvoice(b, 100, { dueInDays: 0 }); // due 'today' in UTC
    // In Pacific/Kiritimati (UTC+14) it is already tomorrow, so the whole due day has passed there.
    await q(`UPDATE "Organization" SET timezone='Pacific/Kiritimati' WHERE id=$1`, [b.orgId]);
    const first = await syncOverdue(b.orgId, { force: true, now: new Date(Date.now() + 12 * 3600_000) });
    assert.ok(first >= 1);
    assert.equal((await inv(id)).status, "OVERDUE");
    const again = await addInvoice(b, 100, { dueInDays: -2 });
    assert.equal(await syncOverdue(b.orgId), 0, "throttled: the second call within five minutes does nothing");
    assert.equal((await inv(again)).status, "UNPAID");
    assert.ok((await syncOverdue(b.orgId, { force: true })) >= 1);
    assert.equal((await inv(again)).status, "OVERDUE");
  });

  await check("paying an overdue invoice in full makes it PAID (the sweep never overrides a payment)", async () => {
    const id = await addInvoice(a, 250, { dueInDays: -4 });
    await syncOverdue(a.orgId, { force: true });
    assert.equal((await inv(id)).status, "OVERDUE");
    assert.equal((await recordPayment(a.admin, { invoiceId: id, amount: 250, paidOn: today })).status, "PAID");
    await syncOverdue(a.orgId, { force: true });
    assert.equal((await inv(id)).status, "PAID");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
