// Database-backed tests of the master console (Phase 6). Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
const emailFile = process.env.EMAIL_FILE;
if (!ownerUrl || !emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");
const repoRoot = path.resolve(process.cwd(), "../..");

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
  return error as Error;
}

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 200;
const ip = () => `192.0.2.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { createTicket } = await import("@/lib/flows/support");
  const { rawDb } = await import("@/lib/db");
  const { platformTx } = await import("@/lib/master/db");
  const q2 = await import("@/lib/master/queries");
  const ops = await import("@/lib/master/ops");
  const { getEntitlements } = await import("@/lib/plans/entitlements");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((m) => m.to === email && m.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string; slug: string }>(`SELECT o.id, o.slug FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    const [user] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    return { orgId: org.id, slug: org.slug, user: { id: user.id, name: `${name} Admin`, email, orgId: org.id } };
  };
  const count = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);
  const sub = async (orgId: string) => (await q<{ quantity: number; status: string; billing: string; extraQuantity: number; overrides: unknown }>(`SELECT quantity, status, billing, "extraQuantity", overrides FROM "Subscription" WHERE "organizationId"=$1`, [orgId]))[0];

  const ops1 = await makeCompany("Vendor Ops", "ops@vendor-ops.test"); // our own team's company
  const a = await makeCompany("Alpha Master", "admin@alpha-master.test");
  const b = await makeCompany("Beta Master", "admin@beta-master.test");
  const admin = { id: ops1.user.id, email: ops1.user.email, name: ops1.user.name };

  const t1 = await createTicket({ ...a.user, name: "Alpha Admin" }, { subject: "Alpha cannot upload", message: "Uploads fail with an error since yesterday." });
  const t2 = await createTicket({ ...b.user, name: "Beta Admin" }, { subject: "Beta billing question", message: "Where do I download my receipts?" });
  assert.ok(t1.ok && t2.ok);

  // ---------------------------------------------------------- database access
  await check("without the platform switch a plain connection sees NO tickets, logs or projects of any company", async () => {
    assert.equal((await rawDb.supportTicket.findMany()).length, 0);
    assert.equal((await rawDb.activityLog.findMany({ where: { organizationId: a.orgId } })).length, 0);
    assert.equal((await rawDb.project.findMany()).length, 0);
  });

  await check("platformTx reads tickets, logs and projects across companies", async () => {
    const r = await platformTx(async (tx) => ({
      tickets: await tx.supportTicket.findMany({ select: { organizationId: true } }),
      projects: await tx.project.findMany({ select: { organizationId: true } }),
      logs: await tx.activityLog.count(),
    }));
    const tOrgs = new Set(r.tickets.map((t) => t.organizationId));
    assert.ok(tOrgs.has(a.orgId) && tOrgs.has(b.orgId), "tickets of both companies");
    const pOrgs = new Set(r.projects.map((p) => p.organizationId));
    assert.ok(pOrgs.has(a.orgId) && pOrgs.has(b.orgId) && pOrgs.has(ops1.orgId), "projects of all three companies");
    assert.ok(r.logs > 0);
  });

  await check("platformTx can NOT write projects, invoices-side data or logs, and can not delete tickets", async () => {
    await rejects(platformTx((tx) => tx.project.create({ data: { organizationId: a.orgId, name: "Injected" } })));
    const ticketsBefore = await count(`SELECT count(*) n FROM "SupportTicket"`);
    const upd = await platformTx((tx) => tx.project.updateMany({ data: { name: "Renamed" }, where: {} }));
    assert.equal(upd.count, 0, "projects are read-only for the platform");
    const del = await platformTx((tx) => tx.project.deleteMany({}));
    assert.equal(del.count, 0);
    const logUpd = await platformTx((tx) => tx.activityLog.updateMany({ data: { action: "TAMPERED" }, where: {} }));
    assert.equal(logUpd.count, 0, "logs cannot be edited");
    const tdel = await platformTx((tx) => tx.supportTicket.deleteMany({}));
    assert.equal(tdel.count, 0, "tickets cannot be deleted");
    assert.equal(await count(`SELECT count(*) n FROM "Project" WHERE name IN ('Injected','Renamed')`), 0);
    assert.equal(await count(`SELECT count(*) n FROM "SupportTicket"`), ticketsBefore);
  });

  await check("a company's own handle still sees only its own tickets (the platform policy did not widen anything)", async () => {
    const { dbFor } = await import("@/lib/org/scoped-db");
    const mine = await dbFor(a.orgId).supportTicket.findMany();
    assert.deepEqual(mine.map((t) => t.organizationId), [a.orgId]);
  });

  // ---------------------------------------------------------- reading
  await check("company list: search, state filter, counts and paging", async () => {
    const all = await q2.listCompanies({ q: "master" });
    assert.equal(all.total, 2);
    assert.equal(all.counts.trial, 2);
    assert.ok((await q2.listCompanies({})).total >= 3);
    const one = await q2.listCompanies({ q: "alpha-master" });
    assert.deepEqual(one.rows.map((r) => r.id), [a.orgId]);
    assert.equal(one.rows[0].members, 1);
    assert.equal(one.rows[0].projects, 1);
    assert.equal((await q2.listCompanies({ q: "master", state: "past_due" })).total, 0);
    assert.equal((await q2.listCompanies({ page: 5 })).rows.length, 0);
  });

  await check("company detail shows plan, people, projects, tickets and activity of THAT company only", async () => {
    const d = (await q2.companyDetail(a.orgId))!;
    assert.equal(d.org.id, a.orgId);
    assert.equal(d.members.length, 1);
    assert.ok(d.projects.every((p) => p.id));
    assert.deepEqual(d.tickets.map((t) => t.organizationId), [a.orgId]);
    assert.ok(d.activity.every((x) => x.organizationId === a.orgId));
    assert.equal(d.entitlements.state, "trial");
    assert.equal(await q2.companyDetail("does-not-exist"), null);
  });

  await check("overview counts companies, open tickets and plans by state", async () => {
    const o = await q2.overview();
    assert.ok(o.companies >= 3);
    assert.ok(o.openTickets >= 2);
    assert.ok(o.counts.trial >= 3);
  });

  await check("tickets: filter by status and search by company, subject, number; logs filter by module and company", async () => {
    assert.ok((await q2.listTickets({ status: "ACTIVE" })).total >= 2);
    assert.equal((await q2.listTickets({ q: "Beta" })).rows[0].organization.id, b.orgId);
    assert.equal((await q2.listTickets({ q: "Alpha cannot" })).total, 1);
    const num = (await platformTx((tx) => tx.supportTicket.findFirst({ where: { organizationId: a.orgId } })))!.number;
    assert.equal((await q2.listTickets({ q: String(num) })).total, 1);
    const acts = await q2.listActivity({ module: "AUTH" });
    assert.ok(acts.rows.every((r) => r.module === "AUTH"));
    assert.ok((await q2.listActivity({ orgId: a.orgId })).rows.every((r) => r.organizationId === a.orgId));
    assert.equal((await q2.listErrors({ orgId: a.orgId })).total, 0);
  });

  // ---------------------------------------------------------- changes
  await check("every change needs a reason", async () => {
    await rejects(ops.setProjectPlans(admin, a.orgId, 2, ""), /reason/i);
    await rejects(ops.setProjectPlans(admin, a.orgId, 2, "  "), /reason/i);
    await rejects(ops.extendTrial(admin, a.orgId, 7, "x"), /reason/i);
    assert.equal((await sub(a.orgId)).quantity, 1);
  });

  await check("project plans: hand-managed company gets the total set; invalid numbers refused; limits follow at once", async () => {
    await rejects(ops.setProjectPlans(admin, a.orgId, -1, "typo"), /whole number/);
    await rejects(ops.setProjectPlans(admin, a.orgId, 1.5, "typo"), /whole number/);
    await rejects(ops.setProjectPlans(admin, "nope", 1, "typo"), /not found/i);
    await ops.setProjectPlans(admin, a.orgId, 3, "Signed a 3-project deal");
    const s = await sub(a.orgId);
    assert.deepEqual([s.quantity, s.status], [3, "ACTIVE"]);
    const e = await getEntitlements(a.orgId);
    assert.deepEqual([e.limits.projects, e.limits.users], [3, 15]);
  });

  await check("project plans: a company paying through Razorpay gets FREE plans on top of what it bought", async () => {
    await q(`UPDATE "Subscription" SET billing='RAZORPAY', quantity=1, status='ACTIVE', provider='razorpay' WHERE "organizationId"=$1`, [b.orgId]);
    await q(`INSERT INTO "BillingPurchase"(id,"organizationId","planId",provider,"providerSubscriptionId","providerPlanId",status,"paidCount","totalCount","amountMinor",currency,"currentEnd","updatedAt")
             SELECT 'bp_master1', $1, id, 'razorpay','sub_master1','plan_x','active',1,120,99900,'INR',(now() AT TIME ZONE 'UTC') + interval '20 days', now() FROM "Plan" WHERE code='PROJECT'`, [b.orgId]);
    await ops.setProjectPlans(admin, b.orgId, 2, "Partner discount");
    const s = await sub(b.orgId);
    assert.deepEqual([s.extraQuantity, s.quantity, s.status], [2, 3, "ACTIVE"]);
  });

  await check("trial: extends from the end date (or from today when over); logged against the company", async () => {
    await ops.extendTrial(admin, ops1.orgId, 10, "Onboarding delay");
    const [{ days }] = await q<{ days: number }>(`SELECT extract(epoch FROM ("trialEndsAt" - (now() AT TIME ZONE 'UTC')))/86400 AS days FROM "Subscription" WHERE "organizationId"=$1`, [ops1.orgId]);
    assert.ok(days > 23.5 && days < 24.5, `trial should end in about 24 days, got ${days}`);
    await rejects(ops.extendTrial(admin, ops1.orgId, 0, "zero"), /days/);
    await rejects(ops.extendTrial(admin, ops1.orgId, 400, "too long"), /days/);
    const logs = await platformTx((tx) => tx.activityLog.findMany({ where: { action: "MASTER_EXTENDED_TRIAL", organizationId: ops1.orgId } }));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].userId, admin.id);
    assert.match(JSON.stringify(logs[0].details), /Onboarding delay/);
  });

  await check("extra limits: saved, applied, bad values refused, empty AI pages means the plan's value", async () => {
    await ops.setLimits(admin, a.orgId, { extraProjects: 2, extraUsers: 4, aiPagesPerProject: 800 }, "Large customer");
    let e = await getEntitlements(a.orgId);
    assert.deepEqual([e.limits.projects, e.limits.users, e.limits.aiPagesPerProject], [5, 19, 800]);
    await rejects(ops.setLimits(admin, a.orgId, { extraProjects: -1, extraUsers: 0, aiPagesPerProject: null }, "bad"), /whole numbers/);
    await rejects(ops.setLimits(admin, a.orgId, { extraProjects: 0, extraUsers: 0, aiPagesPerProject: Number.NaN }, "bad"), /whole numbers/);
    await ops.setLimits(admin, a.orgId, { extraProjects: 0, extraUsers: 0, aiPagesPerProject: null }, "Back to normal");
    e = await getEntitlements(a.orgId);
    assert.deepEqual([e.limits.projects, e.limits.aiPagesPerProject], [3, 500]);
  });

  await check("suspend: blocks sign-in to that company, keeps data, cannot lock out the operator's own company, reactivates", async () => {
    await rejects(ops.setCompanyStatus(admin, ops1.orgId, "SUSPENDED", "oops"), /lock you out/);
    await ops.setCompanyStatus(admin, b.orgId, "SUSPENDED", "Abuse report 1234");
    assert.equal((await q<{ status: string }>(`SELECT status FROM "Organization" WHERE id=$1`, [b.orgId]))[0].status, "SUSPENDED");
    const { pickDefaultMembership } = await import("@/lib/org/default-membership");
    const m = await rawDb.membership.findMany({ where: { organizationId: b.orgId }, select: { organizationId: true, role: true, createdAt: true, organization: { select: { status: true } } } });
    assert.equal(pickDefaultMembership(m), null, "nobody can enter a suspended company");
    assert.equal(await count(`SELECT count(*) n FROM "Project" WHERE "organizationId"=$1`, [b.orgId]) > 0, true, "data is kept");
    await rejects(ops.setCompanyStatus(admin, b.orgId, "CLOSED", "no"), /ACTIVE or SUSPENDED/);
    await ops.setCompanyStatus(admin, b.orgId, "ACTIVE", "Resolved");
    assert.equal((await q<{ status: string }>(`SELECT status FROM "Organization" WHERE id=$1`, [b.orgId]))[0].status, "ACTIVE");
    await q(`UPDATE "Organization" SET status='CLOSED' WHERE id=$1`, [b.orgId]);
    await rejects(ops.setCompanyStatus(admin, b.orgId, "ACTIVE", "reopen"), /closed/i);
    await q(`UPDATE "Organization" SET status='TRIAL' WHERE id=$1`, [b.orgId]);
  });

  await check("plan editing: validates, changes every company on the plan, price in paise", async () => {
    const good = { name: "Project plan", priceMinor: 99900, currency: "inr", userLimit: 6, aiPagesPerProject: 600, includedProjects: 1 };
    await rejects(ops.editPlan(admin, "PROJECT", { ...good, priceMinor: 5 }, "tiny"), /Check the plan values/);
    await rejects(ops.editPlan(admin, "PROJECT", { ...good, currency: "RUPEES" }, "bad"), /Check the plan values/);
    await rejects(ops.editPlan(admin, "NOPE", good, "missing"), /not found/i);
    await ops.editPlan(admin, "PROJECT", good, "Launch pricing");
    const [p] = await q<{ priceMinor: number; currency: string; userLimit: number }>(`SELECT "priceMinor", currency, "userLimit" FROM "Plan" WHERE code='PROJECT'`);
    assert.deepEqual([p.priceMinor, p.currency, p.userLimit], [99900, "INR", 6]);
    assert.equal((await getEntitlements(ops1.orgId)).limits.users, 6, "limits changed for the company on the plan");
  });

  await check("tickets: status changes (resolved gets a date, reopening clears it), invalid status refused, logged", async () => {
    const id = (await platformTx((tx) => tx.supportTicket.findFirst({ where: { organizationId: a.orgId } })))!.id;
    await ops.setTicketStatus(admin, id, "WAITING");
    await ops.setTicketStatus(admin, id, "RESOLVED");
    let [t] = await q<{ status: string; resolvedAt: Date | null }>(`SELECT status, "resolvedAt" FROM "SupportTicket" WHERE id=$1`, [id]);
    assert.deepEqual([t.status, !!t.resolvedAt], ["RESOLVED", true]);
    await ops.setTicketStatus(admin, id, "OPEN");
    [t] = await q(`SELECT status, "resolvedAt" FROM "SupportTicket" WHERE id=$1`, [id]);
    assert.deepEqual([t.status, t.resolvedAt], ["OPEN", null]);
    await rejects(ops.setTicketStatus(admin, id, "DELETED"), /OPEN, WAITING or RESOLVED/);
    await rejects(ops.setTicketStatus(admin, "nope", "OPEN"), /not found/i);
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='MASTER_TICKET_STATUS' AND "organizationId"=$1`, [a.orgId]), 3);
  });

  await check("audit trail: every change above is in the log with who, what and why, and shows in the master log view", async () => {
    const r = await q2.listActivity({ module: "MASTER" });
    const actions = new Set(r.rows.map((x) => x.action));
    for (const want of ["MASTER_GRANTED_PLANS", "MASTER_EXTENDED_TRIAL", "MASTER_SET_LIMITS", "MASTER_SET_COMPANY_STATUS", "MASTER_EDITED_PLAN", "MASTER_TICKET_STATUS"]) assert.ok(actions.has(want), want);
    assert.ok(r.rows.every((x) => x.user?.email === admin.email));
    const limits = r.rows.find((x) => x.action === "MASTER_SET_LIMITS")!;
    assert.match(JSON.stringify(limits.details), /Large customer|Back to normal/);
  });

  await check("the logs of one company cannot be edited or deleted even through the console's connection", async () => {
    const del = await platformTx((tx) => tx.activityLog.deleteMany({}));
    assert.equal(del.count, 0);
  });

  // ---------------------------------------------------------- operator command
  const cli = (args: string[]) => spawnSync("npx", ["tsx", "scripts/master-cli.ts", ...args], { cwd: path.join(repoRoot, "packages", "db"), env: { ...process.env, DATABASE_URL: ownerUrl, MIGRATE_DATABASE_URL: ownerUrl }, shell: true, encoding: "utf8" });

  await check("operator command: add, list, remove; unknown or unverified accounts refused; signs the person out everywhere", async () => {
    assert.doesNotMatch(cli(["list"]).stdout, new RegExp(ops1.user.email));
    const before = (await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE email=$1`, [ops1.user.email]))[0].sessionVersion;
    const add = cli(["add", ops1.user.email]);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    assert.equal((await q<{ isPlatformAdmin: boolean }>(`SELECT "isPlatformAdmin" FROM "User" WHERE email=$1`, [ops1.user.email]))[0].isPlatformAdmin, true);
    assert.equal((await q<{ sessionVersion: number }>(`SELECT "sessionVersion" FROM "User" WHERE email=$1`, [ops1.user.email]))[0].sessionVersion, before + 1);
    assert.match(cli(["list"]).stdout, new RegExp(ops1.user.email));
    assert.notEqual(cli(["add", "nobody@nowhere.test"]).status, 0);
    await q(`UPDATE "User" SET "emailVerifiedAt"=NULL WHERE email='admin@beta-master.test'`);
    assert.notEqual(cli(["add", "admin@beta-master.test"]).status, 0, "an unverified account cannot become an operator");
    assert.equal(cli(["remove", ops1.user.email]).status, 0);
    assert.equal((await q<{ isPlatformAdmin: boolean }>(`SELECT "isPlatformAdmin" FROM "User" WHERE email=$1`, [ops1.user.email]))[0].isPlatformAdmin, false);
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action IN ('MASTER_OPERATOR_ADDED','MASTER_OPERATOR_REMOVED')`), 2);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
