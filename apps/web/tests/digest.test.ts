// Database-backed tests of the daily email digest. Run through `npm run test:isolation`.
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
const digestsTo = (email: string) => mails().filter((m) => m.to === email && /daily summary|overdue|due this week|waiting for review/.test(m.subject));
let ipCounter = 220;
const ip = () => `192.0.2.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { sendDailyDigests, hourIn } = await import("@/lib/flows/digest");
  const { clearLockCache } = await import("@/lib/plans/lock");
  const route = await import("@/app/api/jobs/digest/route");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string, tz = "UTC") => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`UPDATE "Organization" SET timezone=$2 WHERE id=$1`, [org.id, tz]);
    const [proj] = await q<{ id: string }>(`SELECT id FROM "Project" WHERE "organizationId"=$1 LIMIT 1`, [org.id]);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,$3)`, [`v_${org.id}`, org.id, `${name} Supplier`]);
    return { orgId: org.id, email, projectId: proj.id, vendor: `${name} Supplier` };
  };
  let n = 0;
  const addInvoice = async (c: Awaited<ReturnType<typeof makeCompany>>, total: number, o: { status?: string; due: string | null }) => {
    const id = `inv_dg_${++n}_${c.orgId.slice(-4)}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate","dueDate",subtotal,sgst,cgst,igst,rounding,total,status,"fileUrl","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,${o.due ? `'${o.due}'::timestamp` : "NULL"},$6,0,0,0,0,$6,$7::"InvoiceStatus",'x',now())`,
      [id, c.orgId, `DG-${n}`, c.projectId, `v_${c.orgId}`, total, o.status ?? "UNPAID"],
    );
    return id;
  };
  const sentOn = async (orgId: string) => (await q<{ digestSentOn: string | null }>(`SELECT "digestSentOn" FROM "Organization" WHERE id=$1`, [orgId]))[0].digestSentOn;

  const a = await makeCompany("Digest Alpha", "admin@digest-alpha.test");
  const b = await makeCompany("Digest Beta", "admin@digest-beta.test");
  // Alpha: a second administrator who opted out, and a staff member
  await q(`INSERT INTO "User"(id,name,email,"passwordHash",role,"emailVerifiedAt","emailDigest","updatedAt") VALUES ('u_dg_off','Opted Out','off@digest-alpha.test','x','ADMIN',now(),false,now()), ('u_dg_staff','Staff Person','staff@digest-alpha.test','x','STAFF',now(),true,now()), ('u_dg_admin2','Second Admin','admin2@digest-alpha.test','x','ADMIN',now(),true,now())`);
  await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_dg_off','u_dg_off',$1,'ADMIN'),('m_dg_staff','u_dg_staff',$1,'STAFF'),('m_dg_a2','u_dg_admin2',$1,'ADMIN')`, [a.orgId]);
  // Alpha owes money: one overdue, one due in 3 days; Beta owes nothing overdue (a paid invoice only)
  await addInvoice(a, 5000, { due: "2026-10-01" });
  await addInvoice(a, 1200, { due: "2026-10-26" });
  await addInvoice(a, 300, { status: "NEEDS_REVIEW", due: null });
  await addInvoice(b, 777, { status: "PAID", due: "2026-10-01" });
  const morning = new Date("2026-10-23T09:00:00Z"); // 9 o'clock in UTC

  await check("a company with overdue and due-soon invoices: administrators get ONE email with the amounts; staff and opted-out admins get none", async () => {
    const run = await sendDailyDigests({ now: morning, hour: 8 });
    assert.ok(run.sent >= 1 && run.emails >= 2, JSON.stringify(run));
    const first = digestsTo(a.email);
    const second = digestsTo("admin2@digest-alpha.test");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1, "every opted-in administrator");
    assert.equal(digestsTo("off@digest-alpha.test").length, 0, "opted out");
    assert.equal(digestsTo("staff@digest-alpha.test").length, 0, "staff never get it");
    const m = first[0];
    assert.match(m.subject, /Digest Alpha/);
    assert.match(m.subject, /5,000\.00 overdue/);
    assert.match(m.subject, /1,200\.00 due this week/);
    assert.match(m.text, /Digest Alpha Supplier DG-\d+/);
    assert.match(m.text, /Waiting for review: 1/);
    assert.match(m.html, /Open my dashboard/);
    assert.equal(await sentOn(a.orgId), "2026-10-23");
  });

  await check("one company's email never contains another company's data", async () => {
    const m = digestsTo(a.email)[0];
    assert.ok(!m.text.includes("Digest Beta") && !m.html.includes("Digest Beta"));
    assert.ok(!m.text.includes("777"));
  });

  await check("a nothing-to-report company gets no email (and is marked for the day so it is not re-checked every hour)", async () => {
    assert.equal(digestsTo(b.email).length, 0);
    assert.equal(await sentOn(b.orgId), "2026-10-23");
  });

  await check("running again the same day sends nothing more; the next day it sends again", async () => {
    const before = digestsTo(a.email).length;
    const again = await sendDailyDigests({ now: new Date("2026-10-23T15:00:00Z"), hour: 8 });
    assert.ok(again.skipped.alreadySent >= 1);
    assert.equal(digestsTo(a.email).length, before);
    const tomorrow = await sendDailyDigests({ now: new Date("2026-10-24T09:00:00Z"), hour: 8 });
    assert.ok(tomorrow.sent >= 1);
    assert.equal(digestsTo(a.email).length, before + 1);
    assert.match(digestsTo(a.email).at(-1)!.text, /Digest Alpha Supplier/);
  });

  await check("two runs at the same moment send only one email (the day is claimed first)", async () => {
    const c = await makeCompany("Digest Gamma", "admin@digest-gamma.test");
    await addInvoice(c, 900, { due: "2026-09-01" });
    const now = new Date("2026-10-25T09:00:00Z");
    await Promise.all([sendDailyDigests({ now, hour: 8 }), sendDailyDigests({ now, hour: 8 }), sendDailyDigests({ now, hour: 8 })]);
    assert.equal(digestsTo(c.email).length, 1);
  });

  await check("nothing goes out before the morning hour in the COMPANY's own time zone", async () => {
    const c = await makeCompany("Digest Delta", "admin@digest-delta.test", "America/New_York");
    await addInvoice(c, 450, { due: "2026-09-01" });
    // 05:00 UTC is 01:00 in New York: too early
    assert.equal(hourIn("America/New_York", new Date("2026-10-26T05:00:00Z")), 1);
    await sendDailyDigests({ now: new Date("2026-10-26T05:00:00Z"), hour: 8 });
    assert.equal(digestsTo(c.email).length, 0);
    assert.equal(await sentOn(c.orgId), null, "not marked: it can still go out later");
    // 13:00 UTC is 09:00 in New York
    await sendDailyDigests({ now: new Date("2026-10-26T13:00:00Z"), hour: 8 });
    assert.equal(digestsTo(c.email).length, 1);
    assert.equal(await sentOn(c.orgId), "2026-10-26");
  });

  await check("a locked company (trial over) gets nothing and is not marked", async () => {
    const c = await makeCompany("Digest Locked", "admin@digest-locked.test");
    await addInvoice(c, 450, { due: "2026-09-01" });
    await q(`UPDATE "Subscription" SET status='TRIALING', "trialEndsAt"=now() - interval '3 days' WHERE "organizationId"=$1`, [c.orgId]);
    clearLockCache(c.orgId);
    const run = await sendDailyDigests({ now: new Date("2026-10-27T09:00:00Z"), hour: 8 });
    assert.ok(run.skipped.locked >= 1);
    assert.equal(digestsTo(c.email).length, 0);
    assert.equal(await sentOn(c.orgId), null);
  });

  await check("when the mail server is down nothing is lost: the day is given back and the next run delivers", async () => {
    const c = await makeCompany("Digest Retry", "admin@digest-retry.test");
    await addInvoice(c, 450, { due: "2026-09-01" });
    const now = new Date("2026-10-28T09:00:00Z");
    process.env.EMAIL_TRANSPORT = "none";
    const down = await sendDailyDigests({ now, hour: 8 });
    process.env.EMAIL_TRANSPORT = "file";
    assert.ok(down.failed >= 1, JSON.stringify(down));
    assert.equal(digestsTo(c.email).length, 0);
    assert.equal(await sentOn(c.orgId), null, "not marked as sent");
    await sendDailyDigests({ now: new Date("2026-10-28T10:00:00Z"), hour: 8 });
    assert.equal(digestsTo(c.email).length, 1);
  });

  await check("turning the email off on the Account page stops it; turning it back on resumes it", async () => {
    const c = await makeCompany("Digest Toggle", "admin@digest-toggle.test");
    await addInvoice(c, 450, { due: "2026-09-01" });
    await q(`UPDATE "User" SET "emailDigest"=false WHERE email=$1`, [c.email]);
    await sendDailyDigests({ now: new Date("2026-10-29T09:00:00Z"), hour: 8 });
    assert.equal(digestsTo(c.email).length, 0);
    await q(`UPDATE "User" SET "emailDigest"=true WHERE email=$1`, [c.email]);
    await sendDailyDigests({ now: new Date("2026-10-30T09:00:00Z"), hour: 8 });
    assert.equal(digestsTo(c.email).length, 1);
  });

  await check("the scheduler address is closed without the secret, and works with it", async () => {
    const keep = process.env.JOBS_SECRET;
    delete process.env.JOBS_SECRET;
    const call = (auth?: string) => route.POST(new Request("http://app.test/api/jobs/digest", { method: "POST", headers: auth ? { authorization: auth } : {} }));
    assert.equal((await call()).status, 401, "switched off when no secret is set");
    process.env.JOBS_SECRET = "short";
    assert.equal((await call("Bearer short")).status, 401, "a short secret is not accepted");
    process.env.JOBS_SECRET = "a-long-enough-secret-123";
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer wrong-wrong-wrong-wrong")).status, 401);
    const ok = await call("Bearer a-long-enough-secret-123");
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { ok: boolean; checked: number };
    assert.equal(body.ok, true);
    assert.ok(body.checked >= 1);
    if (keep === undefined) delete process.env.JOBS_SECRET;
    else process.env.JOBS_SECRET = keep;
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
