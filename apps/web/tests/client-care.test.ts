// Database-backed tests of client care in the master console: where each company is in the funnel, what needs attention,
// the team's notes and follow-ups, and that none of it can be reached from a company's side. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ownerUrl = process.env.TEST_OWNER_DATABASE_URL;
if (!ownerUrl || !process.env.DATABASE_URL) {
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
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const queries = await import("@/lib/master/queries");
  const ops = await import("@/lib/master/ops");
  const { rawDb } = await import("@/lib/db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const operator = { id: "u_care_op", email: "care-operator@platform.test", name: "Care Operator", twoStep: true };
  await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","isPlatformAdmin","updatedAt") VALUES ($1,'Care Operator',$2,'x',now(),true,now())`, [operator.id, operator.email]);

  async function company(id: string, o: { created: Date; status: string; trialEnds?: Date | null; periodEnd?: Date | null; projects?: number; lastActive?: Date | null }) {
    await q(`INSERT INTO "Organization"(id,name,slug,status,"createdAt","updatedAt") VALUES ($1,$2,$1,'ACTIVE',$3,now())`, [id, `Care ${id}`, o.created.toISOString()]);
    await q(`INSERT INTO "Subscription"(id,"organizationId","planId",quantity,status,"trialEndsAt","currentPeriodEnd","updatedAt") VALUES ($1,$2,'plan_project',1,$3::"SubscriptionStatus",$4,$5,now())`, [`s_${id}`, id, o.status, o.trialEnds?.toISOString() ?? null, o.periodEnd?.toISOString() ?? null]);
    for (let i = 0; i < (o.projects ?? 0); i++) await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [`p_${id}_${i}`, id, `Project ${i}`]);
    if (o.lastActive) await q(`INSERT INTO "ActivityLog"(id,"organizationId",action,module,"createdAt") VALUES ($1,$2,'INVOICE_CREATED','INVOICE',$3)`, [`a_${id}`, id, o.lastActive.toISOString()]);
  }

  await company("care_new", { created: ago(1), status: "TRIALING", trialEnds: ahead(13) });
  await company("care_stalled", { created: ago(6), status: "TRIALING", trialEnds: ahead(8) });
  await company("care_ending", { created: ago(12), status: "TRIALING", trialEnds: ahead(2), projects: 1, lastActive: ago(1) });
  await company("care_using", { created: ago(10), status: "TRIALING", trialEnds: ahead(10), projects: 2, lastActive: ago(2) });
  await company("care_paying", { created: ago(60), status: "ACTIVE", projects: 3, lastActive: ago(1) });
  await company("care_quiet", { created: ago(90), status: "ACTIVE", projects: 3, lastActive: ago(30) });
  await company("care_late", { created: ago(90), status: "PAST_DUE", projects: 1, lastActive: ago(1) });
  await company("care_gone", { created: ago(40), status: "TRIALING", trialEnds: ago(10), projects: 1, lastActive: ago(20) });
  // Our own visits to a company are not the company being active.
  await q(`INSERT INTO "ActivityLog"(id,"organizationId",action,module,"createdAt") VALUES ('a_care_visit','care_new','MASTER_VIEWED_COMPANY','MASTER',now())`);

  const all = (await queries.listCompanies({ q: "Care care_", page: 1 })).rows;
  const byId = new Map((await Promise.all(["new", "stalled", "ending", "using", "paying", "quiet", "late", "gone"].map(async (n) => (await queries.listCompanies({ q: `care_${n}`, page: 1 })).rows.find((r) => r.id === `care_${n}`)!))).map((r) => [r.id, r]));
  void all;
  const row = (n: string) => byId.get(`care_${n}`)!;

  await check("each company lands in the right stage of the funnel", () => {
    assert.deepEqual(
      ["new", "stalled", "ending", "using", "paying", "quiet", "late", "gone"].map((n) => row(n).stage),
      ["signed_up", "signed_up", "using", "using", "paying", "paying", "paying", "lost"],
    );
  });

  await check("our own visits do not count as the company being active", () => {
    assert.equal(row("new").lastActiveAt, null);
    assert.ok(row("using").lastActiveAt && Date.now() - row("using").lastActiveAt!.getTime() < 3 * DAY);
  });

  await check("what needs attention is named in plain words", () => {
    assert.deepEqual(row("new").reasons, [], "a company that signed up yesterday is fine");
    assert.deepEqual(row("stalled").reasons.map((r) => r.text), ["No project after 6 days"]);
    assert.deepEqual(row("ending").reasons.map((r) => r.text), ["Trial ends in 2 days"]);
    assert.equal(row("ending").level, "risk");
    assert.equal(row("using").level, "ok");
    assert.deepEqual(row("quiet").reasons.map((r) => r.text), ["Paying but no activity for 30 days"]);
    assert.equal(row("late").level, "risk");
    assert.equal(row("gone").level, "risk");
    assert.equal(row("paying").level, "ok");
  });

  await check("the list can be narrowed by stage and by 'needs attention'", async () => {
    const lost = await queries.listCompanies({ q: "care_", stage: "lost" });
    assert.deepEqual(lost.rows.map((r) => r.id), ["care_gone"]);
    const attention = await queries.listCompanies({ q: "care_", attention: true });
    assert.deepEqual(new Set(attention.rows.map((r) => r.id)), new Set(["care_stalled", "care_ending", "care_quiet", "care_late", "care_gone"]));
    assert.ok(attention.stageCounts.paying >= 3);
  });

  await check("the overview counts stages, trials ending soon and who is at risk", async () => {
    const o = await queries.overview();
    assert.ok(o.stages.paying >= 3 && o.stages.lost >= 1 && o.stages.using >= 2 && o.stages.signed_up >= 2);
    assert.ok(o.trialsEnding.some((c) => c.id === "care_ending" && c.trialDaysLeft === 2));
    assert.ok(!o.trialsEnding.some((c) => c.id === "care_using"), "ten days left is not 'ending'");
    assert.ok(o.needAttention >= 3);
  });

  await check("a note is saved with who wrote it, tidied up, and shows on the company page", async () => {
    const id = await ops.addNote(operator, "care_using", "  Spoke to the site manager.\r\nWants the phone app.  ");
    assert.ok(id);
    const d = await queries.companyDetail("care_using");
    assert.equal(d!.notes.length, 1);
    assert.deepEqual([d!.notes[0].body, d!.notes[0].authorEmail, d!.notes[0].authorId], ["Spoke to the site manager.\nWants the phone app.", operator.email, operator.id]);
    assert.equal(d!.health?.stage, "using");
    const [log] = await q<{ n: string }>(`SELECT count(*) AS n FROM "ActivityLog" WHERE "organizationId"='care_using' AND action='MASTER_ADDED_NOTE'`);
    assert.equal(Number(log.n), 1, "written to the audit log");
  });

  await check("an empty, oversized or misdirected note is refused and nothing is saved", async () => {
    await rejects(ops.addNote(operator, "care_using", "   "), /Write the note/);
    await rejects(ops.addNote(operator, "care_using", "x".repeat(ops.NOTE_MAX + 1)), /Write the note/);
    await rejects(ops.addNote(operator, "care_using", 42), /Write the note/);
    await rejects(ops.addNote(operator, "no_such_company", "hello"), /not found/i);
    const [n] = await q<{ n: string }>(`SELECT count(*) AS n FROM "ClientNote"`);
    assert.equal(Number(n.n), 1);
  });

  await check("a follow-up needs a task and a date from today on; it can be done and opened again", async () => {
    const due = isoDay(ahead(2));
    const id = await ops.addFollowUp(operator, "care_ending", { task: "Call about the trial ending", dueOn: due });
    await rejects(ops.addFollowUp(operator, "care_ending", { task: "", dueOn: due }), /Say what to do/);
    await rejects(ops.addFollowUp(operator, "care_ending", { task: "Yesterday", dueOn: isoDay(ago(1)) }), /past/);
    await rejects(ops.addFollowUp(operator, "care_ending", { task: "Soon", dueOn: "tomorrow" }), /Choose a date/);
    await rejects(ops.addFollowUp(operator, "no_such_company", { task: "x", dueOn: due }), /not found/i);
    await ops.addFollowUp(operator, "care_stalled", { task: "Ask why no project yet", dueOn: isoDay(new Date()) });

    let open = await queries.openFollowUps();
    const mine = open.filter((f) => f.organizationId.startsWith("care_"));
    assert.deepEqual(mine.map((f) => f.task), ["Ask why no project yet", "Call about the trial ending"], "soonest first");
    assert.equal(mine[1].organization.name, "Care care_ending");

    await ops.setFollowUpDone(operator, id, true);
    await ops.setFollowUpDone(operator, id, true); // pressed twice: harmless
    open = await queries.openFollowUps();
    assert.ok(!open.some((f) => f.id === id));
    const done = await queries.recentlyDoneFollowUps();
    assert.ok(done.some((f) => f.id === id && f.doneByEmail === operator.email));
    await ops.setFollowUpDone(operator, id, false);
    assert.ok((await queries.openFollowUps()).some((f) => f.id === id), "open again");
    await rejects(ops.setFollowUpDone(operator, "no_such_followup", true), /not found/i);
  });

  await check("notes and follow-ups cannot be read or written from a company's side of the database", async () => {
    // The ordinary company connection (no platform flag): sees nothing, can add nothing.
    assert.equal((await rawDb.clientNote.findMany()).length, 0);
    assert.equal((await rawDb.clientFollowUp.findMany()).length, 0);
    await rejects(rawDb.clientNote.create({ data: { organizationId: "care_using", authorEmail: "x@y.test", body: "sneaky" } }), /row-level security|violates/i);
    await rejects(rawDb.clientFollowUp.create({ data: { organizationId: "care_using", task: "sneaky", dueOn: new Date(), createdByEmail: "x@y.test" } }), /row-level security|violates/i);
    // Even inside a company's own scope.
    const { dbFor } = await import("@/lib/org/scoped-db");
    assert.equal((await dbFor("care_using").clientNote.findMany()).length, 0, "the database refuses, whatever the client does");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
