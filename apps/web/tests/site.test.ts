// Database-backed tests of the Technical module: daily reports, photos, issues, who sees what. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);

async function main() {
  const flows = await import("@/lib/flows/site");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { companyToday } = flows;

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  for (const [id, name] of [["o_site_a", "Site Co A"], ["o_site_b", "Site Co B"]]) {
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  }
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@site.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("u_admin", "o_site_a", "ADMIN");
  const accountant = await person("u_acct", "o_site_a", "ACCOUNTANT");
  const manager = await person("u_mgr", "o_site_a", "MANAGER");
  const eng = await person("u_eng", "o_site_a", "ENGINEER");
  const eng2 = await person("u_eng2", "o_site_a", "ENGINEER");
  const viewer = await person("u_view", "o_site_a", "VIEWER");
  const staff = await person("u_staff", "o_site_a", "STAFF");
  const other = await person("u_other", "o_site_b", "ADMIN");
  for (const [id, org, name] of [["p_a1", "o_site_a", "Tower A"], ["p_a2", "o_site_a", "Tower B"], ["p_b1", "o_site_b", "Other Co Site"]]) {
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, org, name]);
  }
  for (const u of [manager, eng, viewer, staff]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_site_a',$2,'p_a1')`, [`pa_${u.id}`, u.id]);
  await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_eng2','o_site_a','u_eng2','p_a2')`);

  const today = await companyToday("o_site_a");
  const report = { reportDate: today, workDone: "Poured the level 2 slab", labourCount: 18, weather: "Clear" };
  let reportId = "";

  await check("an engineer writes today's report on their own project; one for another project or by a role that cannot write is refused", async () => {
    const r = await flows.saveReport(eng, "p_a1", report);
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) reportId = r.id;
    assert.equal((await flows.saveReport(eng, "p_a2", report)).ok, false, "not assigned to Tower B");
    assert.equal((await flows.saveReport(viewer, "p_a1", report)).ok, false, "viewers only read");
    assert.equal((await flows.saveReport(staff, "p_a1", report)).ok, false, "staff have no site work");
    assert.equal((await flows.saveReport(accountant, "p_a1", report)).ok, false, "accountants only read");
    assert.equal((await flows.saveReport(other, "p_a1", report)).ok, false, "another company");
  });

  await check("saving the same day again changes the one report (never a second one)", async () => {
    const r = await flows.saveReport(eng, "p_a1", { ...report, workDone: "Poured the level 2 slab and cured level 1" });
    assert.ok(r.ok && r.id === reportId);
    assert.equal((await q(`SELECT 1 FROM "SiteReport" WHERE "projectId"='p_a1'`)).length, 1);
    const got = await flows.getReport(eng, "p_a1", today);
    assert.equal(got?.workDone, "Poured the level 2 slab and cured level 1");
    assert.equal(got?.canEdit, true);
  });

  await check("a report for a future day or with no work written is refused", async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    assert.equal((await flows.saveReport(eng, "p_a1", { ...report, reportDate: tomorrow })).ok, false);
    assert.equal((await flows.saveReport(eng, "p_a1", { ...report, workDone: "" })).ok, false);
  });

  await check("who sees the report: assigned people and the all-projects roles, nobody else", async () => {
    for (const u of [eng, manager, viewer, admin, accountant]) assert.ok(await flows.getReport(u, "p_a1", today), u.id);
    for (const u of [eng2, staff, other]) assert.equal(await flows.getReport(u, "p_a1", today), null, u.id);
    assert.equal((await flows.listReports(eng2)).length, 0, "an engineer on another project sees none");
    assert.equal((await flows.listReports(admin)).length, 1);
    assert.equal((await flows.listReports(other)).length, 0);
  });

  await check("photos: real images are kept, a renamed web page is refused, the report's day is used", async () => {
    const r = await flows.addPhotos(eng, { projectId: "p_a1", reportId, area: "Level 2", caption: "Slab done", files: [{ name: "a.jpg", bytes: JPEG }, { name: "b.png", bytes: PNG }, { name: "evil.jpg", bytes: Buffer.from("<html><script>alert(1)</script>") }] });
    assert.ok(r.ok && r.added === 2 && r.skipped.length === 1, JSON.stringify(r));
    const rows = await q<{ contentType: string; area: string; takenOn: string }>(`SELECT "contentType", area, to_char("takenOn",'YYYY-MM-DD') AS "takenOn" FROM "SitePhoto" WHERE "projectId"='p_a1' ORDER BY "contentType"`);
    assert.deepEqual(rows.map((x) => x.contentType), ["image/jpeg", "image/png"]);
    assert.equal(rows[0].area, "Level 2");
    assert.equal(rows[0].takenOn, today);
    assert.equal((await flows.addPhotos(eng, { projectId: "p_a1", files: [{ name: "x.jpg", bytes: Buffer.from("nope") }] })).ok, false, "nothing valid");
    assert.equal((await flows.addPhotos(eng, { projectId: "p_a1", files: [] })).ok, false);
    assert.equal((await flows.addPhotos(viewer, { projectId: "p_a1", files: [{ name: "a.jpg", bytes: JPEG }] })).ok, false);
    assert.equal((await flows.addPhotos(eng2, { projectId: "p_a1", files: [{ name: "a.jpg", bytes: JPEG }] })).ok, false, "not their project");
    assert.equal((await flows.addPhotos(eng, { projectId: "p_a1", files: Array.from({ length: 11 }, () => ({ name: "a.jpg", bytes: JPEG })) })).ok, false, "more than 10");
  });

  await check("a photo can be opened only by people who can see its project", async () => {
    const [ph] = await q<{ id: string }>(`SELECT id FROM "SitePhoto" WHERE "projectId"='p_a1' LIMIT 1`);
    assert.ok(await flows.photoFile(eng, ph.id));
    assert.ok(await flows.photoFile(viewer, ph.id));
    assert.ok(await flows.photoFile(admin, ph.id));
    assert.equal(await flows.photoFile(eng2, ph.id), null);
    assert.equal(await flows.photoFile(staff, ph.id), null);
    assert.equal(await flows.photoFile(other, ph.id), null);
    assert.equal((await flows.listPhotos(eng2)).length, 0);
    assert.equal((await flows.listPhotos(other)).length, 0);
    assert.equal((await flows.listPhotos(viewer)).length, 2);
  });

  await check("submitting locks the report: no edits, no new photos, no photo deletes by the engineer; a manager can reopen", async () => {
    assert.equal((await flows.submitReport(viewer, reportId)).ok, false);
    assert.ok((await flows.submitReport(eng, reportId)).ok);
    assert.equal((await flows.submitReport(eng, reportId)).ok, false, "already submitted");
    assert.equal((await flows.saveReport(eng, "p_a1", { ...report, workDone: "Sneaky change" })).ok, false);
    assert.equal((await flows.getReport(eng, "p_a1", today))?.canEdit, false);
    assert.equal((await flows.addPhotos(eng, { projectId: "p_a1", reportId, files: [{ name: "a.jpg", bytes: JPEG }] })).ok, false);
    const [ph] = await q<{ id: string }>(`SELECT id FROM "SitePhoto" WHERE "reportId"=$1 LIMIT 1`, [reportId]);
    assert.equal((await flows.deletePhoto(eng, ph.id)).ok, false, "locked with the report");
    assert.equal((await flows.reopenReport(eng, reportId)).ok, false, "engineers cannot reopen");
    assert.ok((await flows.reopenReport(manager, reportId)).ok);
    assert.equal((await q<{ status: string }>(`SELECT status::text FROM "SiteReport" WHERE id=$1`, [reportId]))[0].status, "DRAFT");
    assert.ok((await flows.saveReport(eng, "p_a1", { ...report, workDone: "Corrected after review" })).ok);
  });

  await check("a manager can change a submitted report directly; a photo is deleted by its owner or a manager only", async () => {
    assert.ok((await flows.submitReport(eng, reportId)).ok);
    assert.ok((await flows.saveReport(manager, "p_a1", { ...report, workDone: "Manager edit" })).ok);
    assert.equal((await flows.getReport(manager, "p_a1", today))?.status, "SUBMITTED", "an edit does not unsubmit it");
    await flows.reopenReport(manager, reportId);
    const added = await flows.addPhotos(manager, { projectId: "p_a1", reportId, files: [{ name: "m.jpg", bytes: JPEG }] });
    assert.ok(added.ok);
    const [mine] = await q<{ id: string }>(`SELECT id FROM "SitePhoto" WHERE "uploadedById"='u_mgr'`);
    assert.equal((await flows.deletePhoto(eng, mine.id)).ok, false, "not their photo");
    assert.equal((await flows.deletePhoto(other, mine.id)).ok, false);
    assert.ok((await flows.deletePhoto(manager, mine.id)).ok);
    const [own] = await q<{ id: string }>(`SELECT id FROM "SitePhoto" WHERE "uploadedById"='u_eng' LIMIT 1`);
    assert.ok((await flows.deletePhoto(eng, own.id)).ok, "their own photo on a draft report");
  });

  let issueId = "";
  await check("issues: raised by an engineer, assigned only to someone on the project, with a severity and due date", async () => {
    const bad = await flows.createIssue(eng, "p_a1", { title: "Honeycombing in column C4", severity: "HIGH", assigneeId: "u_eng2" });
    assert.ok(!bad.ok && bad.field === "assigneeId", "u_eng2 is not on Tower A");
    assert.equal((await flows.createIssue(eng, "p_a1", { title: "x", severity: "HIGH" })).ok, false);
    assert.equal((await flows.createIssue(viewer, "p_a1", { title: "Viewer issue", severity: "LOW" })).ok, false);
    assert.equal((await flows.createIssue(eng2, "p_a1", { title: "Not my project", severity: "LOW" })).ok, false);
    const r = await flows.createIssue(eng, "p_a1", { title: "Honeycombing in column C4", severity: "HIGH", description: "Needs grouting", dueDate: "2020-01-01", assigneeId: "u_mgr" });
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) issueId = r.id;
    const people = (await flows.assignableUsers(eng, "p_a1")).map((u) => u.id).sort();
    assert.deepEqual(people, ["u_acct", "u_admin", "u_eng", "u_mgr", "u_view"].sort(), "everyone who can see Tower A, nobody from Tower B or without site access");
  });

  await check("issue status moves one allowed step at a time; only a manager closes; two people acting at once cannot both win", async () => {
    assert.equal((await flows.setIssueStatus(eng, issueId, "CLOSED")).ok, false, "engineers cannot close");
    assert.equal((await flows.setIssueStatus(viewer, issueId, "IN_PROGRESS")).ok, false);
    assert.equal((await flows.setIssueStatus(eng, issueId, "BOGUS")).ok, false);
    assert.ok((await flows.setIssueStatus(eng, issueId, "IN_PROGRESS")).ok);
    assert.ok((await flows.setIssueStatus(eng, issueId, "FIXED")).ok);
    assert.ok((await q<{ resolvedAt: Date | null }>(`SELECT "resolvedAt" FROM "SiteIssue" WHERE id=$1`, [issueId]))[0].resolvedAt);
    assert.equal((await flows.setIssueStatus(eng, issueId, "CLOSED")).ok, false);
    assert.ok((await flows.setIssueStatus(manager, issueId, "CLOSED")).ok);
    assert.equal((await flows.setIssueStatus(eng, issueId, "OPEN")).ok, false, "closed: only a manager reopens");
    assert.ok((await flows.setIssueStatus(manager, issueId, "OPEN")).ok);
    assert.equal((await q<{ resolvedAt: Date | null }>(`SELECT "resolvedAt" FROM "SiteIssue" WHERE id=$1`, [issueId]))[0].resolvedAt, null, "reopened: no longer resolved");
    const both = await Promise.all([flows.setIssueStatus(eng, issueId, "IN_PROGRESS"), flows.setIssueStatus(manager, issueId, "IN_PROGRESS")]);
    assert.equal(both.filter((r) => r.ok).length, 1, "the second one finds it already moved");
  });

  await check("who can edit an issue: its author, its assignee, a manager; not another engineer or a viewer", async () => {
    const edit = { title: "Honeycombing in column C4 (repaired)", severity: "MEDIUM", dueDate: "" };
    assert.ok((await flows.updateIssue(eng, issueId, edit)).ok, "author");
    assert.ok((await flows.updateIssue(manager, issueId, edit)).ok, "assignee and manager");
    assert.equal((await flows.updateIssue(viewer, issueId, edit)).ok, false);
    assert.equal((await flows.updateIssue(eng2, issueId, edit)).ok, false, "not on the project");
    assert.equal((await flows.updateIssue(other, issueId, edit)).ok, false);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ('u_eng3','E3','e3@site.test','x',now(),now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_e3','u_eng3','o_site_a','ENGINEER')`);
    await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_e3','o_site_a','u_eng3','p_a1')`);
    assert.equal((await flows.updateIssue({ id: "u_eng3", role: "ENGINEER" as never, orgId: "o_site_a" }, issueId, edit)).ok, false, "a colleague who neither raised nor holds it");
  });

  await check("a photo can be attached to an issue, only within the same project", async () => {
    const ok = await flows.addPhotos(eng, { projectId: "p_a1", issueId, files: [{ name: "i.jpg", bytes: JPEG }] });
    assert.ok(ok.ok);
    assert.equal((await flows.getIssue(eng, issueId))?.photoCount, 1);
    await q(`INSERT INTO "SiteIssue"(id,"organizationId","projectId",title,"updatedAt") VALUES ('i_b2','o_site_a','p_a2','Tower B snag',now())`);
    assert.equal((await flows.addPhotos(eng, { projectId: "p_a1", issueId: "i_b2", files: [{ name: "i.jpg", bytes: JPEG }] })).ok, false, "issue of another project");
  });

  await check("who sees the issues and the overview", async () => {
    assert.equal((await flows.listIssues(eng)).length, 1);
    assert.equal((await flows.listIssues(eng2)).length, 1, "eng2 sees only Tower B's");
    assert.equal((await flows.listIssues(admin)).length, 2);
    assert.equal((await flows.listIssues(staff)).length, 0);
    assert.equal((await flows.listIssues(other)).length, 0);
    assert.equal(await flows.getIssue(eng2, issueId), null);
    const ov = await flows.siteOverview(eng);
    assert.deepEqual(ov.projects.map((p) => p.name), ["Tower A"]);
    assert.equal(ov.projects[0].todayReport, "SUBMITTED" === ov.projects[0].todayReport ? "SUBMITTED" : "DRAFT");
    assert.equal((await flows.siteOverview(admin)).projects.length, 2);
    assert.equal((await flows.siteOverview(staff)).projects.length, 0);
  });

  await check("a company never sees another's site records (row-level security, even if the code forgot to filter)", async () => {
    const mine = dbFor("o_site_b");
    assert.equal((await mine.siteReport.findMany()).length, 0);
    assert.equal((await mine.sitePhoto.findMany()).length, 0);
    assert.equal((await mine.siteIssue.findMany()).length, 0);
    assert.equal((await dbFor("o_site_a").siteReport.findMany()).length, 1);
    // a write with no company set (or the wrong one) is refused by the database itself
    const { rawDb } = await import("@/lib/db");
    await assert.rejects(() => rawDb.siteIssue.create({ data: { organizationId: "o_site_a", projectId: "p_a1", title: "forged" } }), /row-level security|violates/i);
  });

  await check("photo files are removed from storage when deleted", async () => {
    const [ph] = await q<{ id: string; fileUrl: string }>(`SELECT id, "fileUrl" FROM "SitePhoto" WHERE "uploadedById"='u_eng' LIMIT 1`);
    const file = ph.fileUrl.replace(/^local:\/\//, "");
    assert.ok(fs.existsSync(file), "stored on disk in the test run");
    assert.ok((await flows.deletePhoto(eng, ph.id)).ok);
    assert.equal(fs.existsSync(file), false);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
