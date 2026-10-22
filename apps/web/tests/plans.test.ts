// Database-backed tests of plans, limits and support (Phase 4). Run through `npm run test:isolation`.
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
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 4).join("\n      ")}`);
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

type Mail = { to: string; replyTo?: string; subject: string; text: string; html: string };
const mails = (): Mail[] => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const mailsTo = (email: string) => mails().filter((m) => m.to === email);

let ipCounter = 100;
const ip = () => `203.0.113.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { createInvite, acceptInvite, describeInvite, revokeInvite, listPendingInvites } = await import("@/lib/flows/invite");
  const { createTicket, listTickets, supportMailto, supportAddress, ticketReference } = await import("@/lib/flows/support");
  const ent = await import("@/lib/plans/entitlements");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { rawDb } = await import("@/lib/db");
  const { peekToken } = await import("@/lib/security/tokens");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const lastToken = (email: string, part: string) => {
    const found = mailsTo(email).filter((m) => m.subject.includes(part));
    assert.ok(found.length, `no "${part}" mail to ${email}`);
    return /token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1];
  };
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    assert.ok((await confirmEmail(lastToken(email, "Confirm your email"))).ok);
    const [org] = await q<{ id: string; slug: string }>(`SELECT o.id, o.slug FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    const [user] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    return { orgId: org.id, slug: org.slug, adminId: user.id, admin: { id: user.id, name: `${name} Admin`, orgId: org.id }, email };
  };
  const setSub = (orgId: string, sets: string, params: unknown[] = []) => q(`UPDATE "Subscription" SET ${sets} WHERE "organizationId"=$1`, [orgId, ...params]);
  const addProject = (orgId: string, name: string) =>
    dbFor(orgId).$transaction(async (tx) => {
      await ent.assertCanAddProject(tx, orgId);
      return tx.project.create({ data: { organizationId: orgId, name } });
    });
  const addMember = async (orgId: string, tag: string) => {
    const id = `u_${tag}_${Math.random().toString(36).slice(2, 8)}`;
    await q(`INSERT INTO "User"(id,name,email,"passwordHash",role,"emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x','STAFF',now(),now())`, [id, tag, `${id}@m.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,'STAFF')`, ["m_" + id, id, orgId]);
    return id;
  };

  // ============================================================== defaults and sign-up
  await check("the default plan exists: 1 project, 5 users, 500 AI pages per project; price not set yet", async () => {
    const [p] = await q<{ includedProjects: number; userLimit: number; aiPagesPerProject: number; priceMinor: number | null; active: boolean }>(`SELECT * FROM "Plan" WHERE code='PROJECT'`);
    assert.deepEqual([p.includedProjects, p.userLimit, p.aiPagesPerProject, p.priceMinor, p.active], [1, 5, 500, null, true]);
  });

  const acme = await makeCompany("Plan Acme", "owner@plan-acme.test");

  await check("sign-up gives the new company a free trial of ONE project plan", async () => {
    const [s] = await q<{ quantity: number; status: string; trialEndsAt: Date; code: string }>(`SELECT s.quantity, s.status, s."trialEndsAt", p.code FROM "Subscription" s JOIN "Plan" p ON p.id=s."planId" WHERE s."organizationId"=$1`, [acme.orgId]);
    assert.deepEqual([s.quantity, s.status, s.code], [1, "TRIALING", "PROJECT"]);
    const days = (+s.trialEndsAt - Date.now()) / 86_400_000;
    assert.ok(days > 13 && days <= 14.01, `trial is ${days} days`);
    const e = await ent.getEntitlements(acme.orgId);
    assert.equal(e.state, "trial");
    assert.deepEqual(e.limits, { projects: 1, users: 5, aiPagesPerProject: 500, companyPageCap: 500 });
    assert.deepEqual(e.usage, { projects: 1, users: 1, pendingInvites: 0 });
    assert.ok(e.trialDaysLeft! >= 13);
  });

  // ============================================================== projects: one plan = one project
  await check("projects: the second active project is refused with a plain message; buying the plan again makes room", async () => {
    const e = await rejects(addProject(acme.orgId, "Second"), /includes 1 project and you already have 1/);
    assert.equal((e as { code?: string }).code, "PLAN_001");
    assert.equal((await q(`SELECT 1 FROM "Project" WHERE "organizationId"=$1`, [acme.orgId])).length, 1, "nothing was created");
    await setSub(acme.orgId, `quantity=2`);
    const p = await addProject(acme.orgId, "Second");
    assert.ok(p.id);
    await rejects(addProject(acme.orgId, "Third"), /includes 2 projects/);
  });
  await check("projects: a completed project frees its place; re-activating it takes the place again", async () => {
    const db = dbFor(acme.orgId);
    const second = await db.project.findFirstOrThrow({ where: { name: "Second" } });
    await db.project.update({ where: { id: second.id }, data: { status: "COMPLETED" } });
    const third = await addProject(acme.orgId, "Third");
    assert.ok(third.id);
    await rejects(db.$transaction(async (tx) => { await ent.assertCanAddProject(tx, acme.orgId); }), /includes 2 projects/);
    await db.project.update({ where: { id: second.id }, data: { status: "ARCHIVED" } });
    await db.project.update({ where: { id: third.id }, data: { status: "ARCHIVED" } });
  });
  await check("projects: 8 simultaneous requests for the last place create exactly one project", async () => {
    // quantity 2, 1 active project (the first) -> exactly one place left
    const before = (await ent.getEntitlements(acme.orgId)).usage.projects;
    assert.equal(before, 1);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => addProject(acme.orgId, `Race ${i}`)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "PLAN_001"));
    assert.equal((await ent.getEntitlements(acme.orgId)).usage.projects, 2);
    await setSub(acme.orgId, `quantity=1`);
    await q(`UPDATE "Project" SET status='ARCHIVED' WHERE "organizationId"=$1 AND name LIKE 'Race %'`, [acme.orgId]);
  });

  // ============================================================== users: members + open invitations
  await check("people: invitations take seats, a refused invitation sends nothing, cancelling frees the seat", async () => {
    // plan allows 5 people; the admin is 1
    for (let i = 1; i <= 4; i++) assert.ok((await createInvite(acme.admin, { email: `p${i}@plan-acme.test`, role: "STAFF", projectIds: [] })).ok, `invite ${i}`);
    const full = await createInvite(acme.admin, { email: "p5@plan-acme.test", role: "STAFF", projectIds: [] });
    assert.ok(!full.ok && /includes 5 users and 5 are already taken/.test(full.error), JSON.stringify(full));
    assert.equal(mailsTo("p5@plan-acme.test").length, 0);
    const [open] = await listPendingInvites(acme.orgId);
    assert.ok((await revokeInvite(acme.admin, open.id)).ok);
    assert.ok((await createInvite(acme.admin, { email: "p5@plan-acme.test", role: "STAFF", projectIds: [] })).ok);
  });
  await check("people: joining checks the seat again, refuses a full company WITHOUT using up the link, and works once there is room", async () => {
    // someone is added directly (as an administrator can) while 4 invitations are open: now over the limit
    const extra = await addMember(acme.orgId, "extra");
    const token = lastToken("p1@plan-acme.test", "invited you");
    assert.ok(await describeInvite(token));
    const r = await acceptInvite({ token, name: "P One", password: PW, acceptTerms: true }, null);
    assert.ok(!r.ok && /reached its user limit/.test(r.error), JSON.stringify(r));
    assert.ok(await peekToken(token, "INVITE"), "the invitation is still valid");
    assert.equal((await q(`SELECT 1 FROM "User" WHERE email='p1@plan-acme.test'`)).length, 0, "no account was created");
    await q(`DELETE FROM "Membership" WHERE "userId"=$1`, [extra]);
    const ok = await acceptInvite({ token, name: "P One", password: PW, acceptTerms: true }, null);
    assert.ok(ok.ok, JSON.stringify(ok));
  });
  await check("people: a deleted account does not use a seat", async () => {
    const before = (await ent.getEntitlements(acme.orgId)).usage.users;
    const id = await addMember(acme.orgId, "gone");
    assert.equal((await ent.getEntitlements(acme.orgId)).usage.users, before + 1);
    await q(`UPDATE "User" SET "deletedAt"=now() WHERE id=$1`, [id]);
    assert.equal((await ent.getEntitlements(acme.orgId)).usage.users, before);
    await q(`DELETE FROM "Membership" WHERE "userId"=$1`, [id]);
  });
  await check("people: 8 simultaneous additions into 2 free seats add exactly 2", async () => {
    const shop = await makeCompany("Seat Shop", "owner@seat-shop.test");
    for (let i = 0; i < 2; i++) await addMember(shop.orgId, `s${i}`); // 3 of 5 used
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, async (_, i) => {
        const id = `u_race_${i}_${Date.now()}`;
        await rawDb.$transaction(async (tx) => {
          await ent.assertCanAddUsers(tx, shop.orgId);
          await tx.user.create({ data: { id, name: "r", email: `${id}@m.test`, passwordHash: "x", role: "STAFF", memberships: { create: { organizationId: shop.orgId, role: "STAFF" } } } });
        });
      })
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal((await ent.getEntitlements(shop.orgId)).usage.users, 5);
  });

  // ============================================================== subscription states
  await check("states: an ended trial stops adding projects, people and invoices, but not support", async () => {
    const co = await makeCompany("Expired Co", "owner@expired.test");
    await setSub(co.orgId, `"trialEndsAt"=(now() AT TIME ZONE 'UTC') - interval '1 day'`);
    assert.equal((await ent.getEntitlements(co.orgId)).state, "trial_expired");
    await rejects(addProject(co.orgId, "x"), /free trial has ended/);
    await rejects(rawDb.$transaction((tx) => ent.assertCanAddUsers(tx, co.orgId)), /free trial has ended/);
    await rejects(ent.assertCanInvite(co.orgId), /free trial has ended/);
    await rejects(ent.assertCanUpload(co.orgId), /free trial has ended/);
    const t = await createTicket({ id: co.adminId, name: "Expired Admin", email: co.email, orgId: co.orgId }, { subject: "Please extend", message: "Our trial ended, can you extend it?" });
    assert.ok(t.ok, "a customer can always reach support");
    // existing data is still readable
    assert.equal((await dbFor(co.orgId).project.count()), 1);
  });
  await check("states: payment trouble has a grace period; cancelling keeps access until the period ends", async () => {
    const co = await makeCompany("Late Co", "owner@late.test");
    await setSub(co.orgId, `status='PAST_DUE', "graceEndsAt"=(now() AT TIME ZONE 'UTC') + interval '3 days'`);
    assert.equal((await ent.getEntitlements(co.orgId)).state, "past_due_grace");
    await ent.assertCanUpload(co.orgId);
    await setSub(co.orgId, `"graceEndsAt"=(now() AT TIME ZONE 'UTC') - interval '1 hour'`);
    assert.equal((await ent.getEntitlements(co.orgId)).state, "past_due");
    await rejects(ent.assertCanUpload(co.orgId), /last payment did not go through/);
    await setSub(co.orgId, `status='CANCELED', "currentPeriodEnd"=(now() AT TIME ZONE 'UTC') + interval '5 days'`);
    assert.equal((await ent.getEntitlements(co.orgId)).state, "canceling");
    await ent.assertCanUpload(co.orgId);
    await setSub(co.orgId, `"currentPeriodEnd"=(now() AT TIME ZONE 'UTC') - interval '1 day'`);
    assert.equal((await ent.getEntitlements(co.orgId)).state, "canceled");
    await rejects(ent.assertCanUpload(co.orgId), /subscription has ended/);
  });
  await check("states: a company with no subscription cannot add anything and is told to contact support", async () => {
    const [{ id }] = await q<{ id: string }>(`INSERT INTO "Organization"(id,name,slug,"updatedAt") VALUES ('org_nosub','No Sub','no-sub',now()) RETURNING id`);
    const e = await ent.getEntitlements(id);
    assert.equal(e.state, "none");
    assert.deepEqual(e.limits, { projects: 0, users: 0, aiPagesPerProject: 0, companyPageCap: 0 });
    await rejects(ent.assertCanUpload(id), /does not have a plan yet/);
  });

  // ============================================================== AI page limits
  await check("AI pages: a company admin may lower a project's limit but not raise it above the plan; the company cap is capped too", async () => {
    const e = await ent.getEntitlements(acme.orgId);
    ent.assertProjectPageLimit(e, 500);
    ent.assertProjectPageLimit(e, 100);
    assert.throws(() => ent.assertProjectPageLimit(e, 501), /up to 500 AI pages per project/);
    ent.assertCompanyPageCap(e, 500);
    assert.throws(() => ent.assertCompanyPageCap(e, 501), /up to 500 AI pages per month across all projects/);
    await setSub(acme.orgId, `overrides='{"aiPagesPerProject": 800}'`);
    ent.assertProjectPageLimit(await ent.getEntitlements(acme.orgId), 800);
    await setSub(acme.orgId, `overrides=NULL`);
  });

  // ============================================================== operator command
  await check("operator command: sets quantity and extras, shows the result, records it, and refuses bad input", async () => {
    const run = (args: string[]) =>
      spawnSync("npx", ["tsx", "scripts/plans-cli.ts", ...args], {
        cwd: path.join(repoRoot, "packages", "db"),
        env: { ...process.env, DATABASE_URL: ownerUrl, MIGRATE_DATABASE_URL: ownerUrl },
        shell: true,
        encoding: "utf8",
      });
    const set = run(["set", acme.slug, "--quantity", "3", "--extra-users", "2", "--status", "ACTIVE", "--reason", "bought two more"]);
    assert.equal(set.status, 0, set.stdout + set.stderr);
    assert.match(set.stdout, /Saved\./);
    const e = await ent.getEntitlements(acme.orgId);
    assert.equal(e.state, "active");
    assert.deepEqual([e.limits.projects, e.limits.users, e.limits.companyPageCap], [3, 17, 1500]);
    const show = run(["show", acme.slug]);
    assert.equal(show.status, 0);
    assert.match(show.stdout, /Projects \d+ of 3/);
    assert.equal((await q(`SELECT 1 FROM "ActivityLog" WHERE "organizationId"=$1 AND action='PLAN_CHANGED'`, [acme.orgId])).length, 1);
    assert.notEqual(run(["set", acme.slug, "--status", "BOGUS"]).status, 0);
    assert.notEqual(run(["set", acme.slug, "--quantity", "-2"]).status, 0);
    assert.notEqual(run(["set", "no-such-company", "--quantity", "1"]).status, 0);
    const edit = run(["edit-plan", "PROJECT", "--price", "99900", "--currency", "inr"]);
    assert.equal(edit.status, 0, edit.stdout + edit.stderr);
    assert.equal((await q<{ priceMinor: number }>(`SELECT "priceMinor" FROM "Plan" WHERE code='PROJECT'`))[0].priceMinor, 99900);
    await q(`UPDATE "Plan" SET "priceMinor"=NULL WHERE code='PROJECT'`);
  });

  // ============================================================== support tickets
  const staffId = await addMember(acme.orgId, "support-staff");
  const staffEmail = (await q<{ email: string }>(`SELECT email FROM "User" WHERE id=$1`, [staffId]))[0].email;
  const adminUser = { id: acme.adminId, name: "Plan Acme Admin", email: acme.email, orgId: acme.orgId };
  const staffUser = { id: staffId, name: "Support Staff", email: staffEmail, orgId: acme.orgId };

  await check("support: a ticket gets a reference, the support inbox gets the details with reply-to the customer, and the customer a confirmation", async () => {
    assert.equal(supportAddress(), "support@vendor.test");
    const r = await createTicket(adminUser, { subject: "Upload <b>fails</b>", message: "Every upload shows an error since this morning, please help." });
    assert.ok(r.ok);
    assert.match(r.reference, /^SUP-\d{6}$/);
    assert.equal(r.reference, ticketReference(r.number));
    assert.equal(r.emailed, true);
    const toSupport = mailsTo("support@vendor.test").filter((m) => m.subject.includes(r.reference));
    assert.equal(toSupport.length, 1);
    assert.equal(toSupport[0].replyTo, acme.email, "pressing Reply answers the customer");
    assert.match(toSupport[0].text, /Company: Plan Acme/);
    assert.match(toSupport[0].text, /Plan: Project plan x 3 \(active\)/);
    assert.match(toSupport[0].text, /Priority: HIGH/);
    assert.ok(!toSupport[0].html.includes("<b>fails</b>"), "customer text is escaped in the email");
    const conf = mailsTo(acme.email).filter((m) => m.subject.includes(r.reference));
    assert.equal(conf.length, 1);
    assert.match(conf[0].text, new RegExp(r.reference));
    const [row] = await q<{ status: string; priority: string; planCode: string; organizationId: string }>(`SELECT status, priority, "planCode", "organizationId" FROM "SupportTicket" WHERE number=$1`, [r.number]);
    assert.deepEqual([row.status, row.priority, row.planCode, row.organizationId], ["OPEN", "HIGH", "PROJECT", acme.orgId]);
  });
  await check("support: trial customers are NORMAL priority; vague or oversized requests are refused with the field named", async () => {
    const co = await makeCompany("Trial Tix", "owner@trial-tix.test");
    const r = await createTicket({ id: co.adminId, name: "T", email: co.email, orgId: co.orgId }, { subject: "Question about invoices", message: "How do I export my invoices to Excel please?" });
    assert.ok(r.ok);
    assert.equal((await q<{ priority: string }>(`SELECT priority FROM "SupportTicket" WHERE number=$1`, [r.number]))[0].priority, "NORMAL");
    const short = await createTicket(adminUser, { subject: "Hi", message: "Please help me with something" });
    assert.ok(!short.ok && short.field === "subject");
    const vague = await createTicket(adminUser, { subject: "Help me please", message: "broken" });
    assert.ok(!vague.ok && vague.field === "message");
    const big = await createTicket(adminUser, { subject: "Help me please", message: "x".repeat(5001) });
    assert.ok(!big.ok && big.field === "message");
  });
  await check("support: tickets are limited to 5 per person per hour", async () => {
    const co = await makeCompany("Spammy Co", "owner@spammy.test");
    const u = { id: co.adminId, name: "Spam", email: co.email, orgId: co.orgId };
    let refused = false;
    for (let i = 0; i < 8 && !refused; i++) {
      const r = await createTicket(u, { subject: `Question number ${i}`, message: "This is a perfectly fine question about the app." });
      if (!r.ok && /Too many attempts/.test(r.error)) refused = true;
    }
    assert.ok(refused);
    assert.equal((await q(`SELECT 1 FROM "SupportTicket" WHERE "organizationId"=$1`, [co.orgId])).length, 5);
  });
  await check("support: administrators see the whole company's tickets, staff only their own, other companies none", async () => {
    await createTicket(staffUser, { subject: "Cannot find my project", message: "I was added to a project but I cannot see it." });
    const asAdmin = await listTickets({ id: acme.adminId, orgId: acme.orgId, role: "ADMIN" });
    const asStaff = await listTickets({ id: staffId, orgId: acme.orgId, role: "STAFF" });
    assert.ok(asAdmin.length >= 2 && asAdmin.some((t) => t.name === "Support Staff"));
    assert.deepEqual(asStaff.map((t) => t.name), ["Support Staff"]);
    const other = await makeCompany("Other Tix", "owner@other-tix.test");
    const seen = await listTickets({ id: other.adminId, orgId: other.orgId, role: "ADMIN" });
    assert.equal(seen.length, 0);
    assert.equal((await rawDb.supportTicket.findMany()).length, 0, "with no company set the database shows no tickets (Row-Level Security)");
    assert.equal((await dbFor(other.orgId).supportTicket.count({ where: { organizationId: acme.orgId } })), 0);
  });
  await check("support: the ready-made email link carries the company and plan details, properly encoded", () => {
    const link = supportMailto("support@vendor.test", { company: "Acme & Sons", slug: "acme", plan: "Project plan x 1 (active)", userName: "Ann", userEmail: "ann@x.test" });
    assert.match(link, /^mailto:support@vendor\.test\?subject=/);
    const body = decodeURIComponent(link.split("body=")[1]);
    assert.match(body, /Company: Acme & Sons \(acme\)/);
    assert.match(body, /Plan: Project plan x 1 \(active\)/);
    assert.ok(!link.includes(" "), "no raw spaces");
  });
  await check("support operator command: lists, shows and resolves tickets", async () => {
    const run = (args: string[]) =>
      spawnSync("npx", ["tsx", "scripts/tickets-cli.ts", ...args], { cwd: path.join(repoRoot, "packages", "db"), env: { ...process.env, DATABASE_URL: ownerUrl, MIGRATE_DATABASE_URL: ownerUrl }, shell: true, encoding: "utf8" });
    const list = run(["list", "--status", "OPEN"]);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /SUP-\d{6}/);
    const [{ number }] = await q<{ number: number }>(`SELECT number FROM "SupportTicket" WHERE subject LIKE 'Upload%' LIMIT 1`);
    assert.match(run(["show", String(number)]).stdout, /Every upload shows an error/);
    assert.equal(run(["status", String(number), "RESOLVED"]).status, 0);
    const [t] = await q<{ status: string; resolvedAt: Date | null }>(`SELECT status, "resolvedAt" FROM "SupportTicket" WHERE number=$1`, [number]);
    assert.equal(t.status, "RESOLVED");
    assert.ok(t.resolvedAt);
    assert.notEqual(run(["status", String(number), "BOGUS"]).status, 0);
    assert.notEqual(run(["show", "999999"]).status, 0);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
