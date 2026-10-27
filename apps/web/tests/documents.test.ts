// Database-backed tests of drawings and documents: who adds and sees them, file checks, revisions, serving, and the phone download links.
// Run through `npm run test:isolation`.
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

const PDF = (n = 0) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(100 + n, 1)]);
const DWG = Buffer.concat([Buffer.from("AC1032"), Buffer.alloc(200, 2)]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

async function main() {
  process.env.AUTH_SECRET ||= "documents-test-secret";
  const f = await import("@/lib/flows/documents");
  const http = await import("@/lib/site/doc-http");
  const { signDocLink } = await import("@/lib/site/doc-links");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  for (const [id, name] of [["o_dc_a", "Docs Co A"], ["o_dc_b", "Docs Co B"]]) await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, name, id]);
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@dc.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("dc_admin", "o_dc_a", "ADMIN");
  const mgr = await person("dc_mgr", "o_dc_a", "MANAGER");
  const eng = await person("dc_eng", "o_dc_a", "ENGINEER");
  const eng2 = await person("dc_eng2", "o_dc_a", "ENGINEER");
  const viewer = await person("dc_view", "o_dc_a", "VIEWER");
  const buyer = await person("dc_buyer", "o_dc_a", "PURCHASE");
  const staff = await person("dc_staff", "o_dc_a", "STAFF");
  const other = await person("dc_other", "o_dc_b", "ADMIN");
  for (const [id, org, name] of [["p_dc1", "o_dc_a", "Tower A"], ["p_dc2", "o_dc_a", "Tower B"], ["p_dcb", "o_dc_b", "Other"]]) await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,'ACTIVE',now())`, [id, org, name]);
  for (const k of ["mgr", "eng", "view", "buyer", "staff"]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_dc_a',$2,'p_dc1')`, [`pa_dc_${k}`, `dc_${k}`]);
  await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ('pa_dc_eng2','o_dc_a','dc_eng2','p_dc2')`);

  const meta = { title: "Foundation plan", number: "s-101", category: "STRUCTURAL", revision: "a", note: "First issue" };
  let docId = "";
  let revA = "";

  await check("a project manager adds a drawing: number tidied, first revision kept, file stored", async () => {
    const r = await f.createDocument(mgr, { projectId: "p_dc1", data: meta, file: { name: "S-101 Foundation plan.pdf", bytes: PDF() } });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    docId = r.id;
    const d = (await f.getDocument(mgr, docId))!;
    assert.deepEqual([d.number, d.title, d.category, d.revisionCount, d.current?.revision, d.current?.formatLabel], ["S-101", "Foundation plan", "STRUCTURAL", 1, "A", "PDF"]);
    revA = d.current!.id;
    const [row] = await q<{ fileUrl: string; contentType: string; sizeBytes: number }>(`SELECT "fileUrl","contentType","sizeBytes" FROM "DocumentRevision" WHERE id=$1`, [revA]);
    assert.equal(row.contentType, "application/pdf");
    assert.ok(fs.existsSync(row.fileUrl.replace(/^local:\/\//, "")), "the file is on disk in the test run");
  });

  await check("only roles that issue drawings can add them; the same number cannot be used twice on a project", async () => {
    for (const u of [eng, viewer, buyer, staff, eng2, other]) assert.equal((await f.createDocument(u, { projectId: "p_dc1", data: { ...meta, number: "X-1" }, file: { name: "a.pdf", bytes: PDF() } })).ok, false, u.id);
    const dup = await f.createDocument(admin, { projectId: "p_dc1", data: meta, file: { name: "a.pdf", bytes: PDF() } });
    assert.ok(!dup.ok && dup.field === "number");
    assert.ok((await f.createDocument(admin, { projectId: "p_dc2", data: meta, file: { name: "a.pdf", bytes: PDF() } })).ok, "another project may use the same number");
    assert.ok((await f.createDocument(admin, { projectId: "p_dc1", data: { ...meta, number: "", title: "Site note" }, file: { name: "n.pdf", bytes: PDF() } })).ok, "no number needed");
    assert.ok((await f.createDocument(admin, { projectId: "p_dc1", data: { ...meta, number: "", title: "Another note", revision: "A" }, file: { name: "n2.pdf", bytes: PDF() } })).ok, "several without a number");
  });

  await check("bad files are refused and nothing is saved: a web page named .pdf, a wrong type, empty, too large, no file", async () => {
    const before = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ProjectDocument"`))[0].n);
    const tryFile = async (name: string, bytes: Buffer | null) => f.createDocument(mgr, { projectId: "p_dc1", data: { ...meta, number: "BAD-1" }, file: bytes ? { name, bytes } : null });
    for (const [name, bytes] of [["x.pdf", HTML], ["x.exe", PDF()], ["x.pdf", Buffer.alloc(0)], ["x.dwg", PDF()], ["x.pdf", Buffer.alloc(31 * 1024 * 1024, 1)]] as [string, Buffer][]) {
      const r = await tryFile(name, bytes);
      assert.ok(!r.ok && r.field === "file", name);
    }
    assert.equal((await tryFile("x.pdf", null)).ok, false);
    assert.equal(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "ProjectDocument"`))[0].n), before);
    assert.equal((await f.createDocument(mgr, { projectId: "p_dc1", data: { ...meta, number: "BAD-2", title: "ab" }, file: { name: "a.pdf", bytes: PDF() } })).ok, false, "details are checked too");
  });

  await check("who sees drawings: the project's people and the all-projects roles; not other projects, staff, or other companies", async () => {
    for (const u of [mgr, eng, viewer, buyer, admin]) assert.ok(await f.getDocument(u, docId), u.id);
    for (const u of [eng2, staff, other]) assert.equal(await f.getDocument(u, docId), null, u.id);
    assert.equal((await f.listDocuments(eng2, { projectId: "p_dc1" })).length, 0);
    assert.equal((await f.listDocuments(other)).length, 0);
    assert.ok((await f.listDocuments(eng)).length >= 3);
    assert.deepEqual((await f.listDocuments(eng, { q: "s-101" })).map((d) => d.number), ["S-101"], "search by number, any letter case");
    assert.equal((await f.listDocuments(eng, { category: "STRUCTURAL" })).every((d) => d.category === "STRUCTURAL"), true);
    assert.equal((await f.listDocuments(eng, { category: "NOT_A_CATEGORY" })).length, (await f.listDocuments(eng)).length, "an unknown category is ignored");
  });

  await check("a new revision becomes the current one; the history is kept; labels cannot repeat", async () => {
    assert.equal((await f.addRevision(eng, docId, { data: { revision: "B" }, file: { name: "b.pdf", bytes: PDF(5) } })).ok, false, "engineers cannot issue revisions");
    const b = await f.addRevision(mgr, docId, { data: { revision: "b", note: "Beam B3 enlarged" }, file: { name: "S-101 rev B.pdf", bytes: PDF(5) } });
    assert.ok(b.ok, JSON.stringify(b));
    const dup = await f.addRevision(mgr, docId, { data: { revision: "B" }, file: { name: "again.pdf", bytes: PDF() } });
    assert.ok(!dup.ok && dup.field === "revision");
    const bad = await f.addRevision(mgr, docId, { data: { revision: "C" }, file: { name: "c.pdf", bytes: HTML } });
    assert.ok(!bad.ok && bad.field === "file");
    const d = (await f.getDocument(eng, docId))!;
    assert.deepEqual([d.revisionCount, d.current?.revision, d.revisions.map((r) => r.revision), d.revisions.map((r) => r.isCurrent)], [2, "B", ["B", "A"], [true, false]]);
    assert.equal(d.current?.note, "Beam B3 enlarged");
    const dwg = await f.addRevision(mgr, docId, { data: { revision: "C" }, file: { name: "S-101.dwg", bytes: DWG } });
    assert.ok(dwg.ok, "a different format for the next revision is fine");
    assert.equal((await f.getDocument(eng, docId))?.current?.formatLabel, "AutoCAD DWG");
  });

  await check("archiving hides a drawing from the lists but keeps it and its history; restoring brings it back; no revisions while archived", async () => {
    assert.equal((await f.setArchived(eng, docId, true)).ok, false);
    assert.ok((await f.setArchived(mgr, docId, true)).ok);
    assert.ok(!(await f.listDocuments(eng, { projectId: "p_dc1" })).some((d) => d.id === docId));
    assert.ok((await f.listDocuments(eng, { projectId: "p_dc1", includeArchived: true })).some((d) => d.id === docId));
    assert.equal((await f.getDocument(eng, docId))?.archived, true);
    assert.equal((await f.addRevision(mgr, docId, { data: { revision: "D" }, file: { name: "d.pdf", bytes: PDF() } })).ok, false);
    assert.ok((await f.setArchived(mgr, docId, false)).ok);
    assert.ok((await f.listDocuments(eng, { projectId: "p_dc1" })).some((d) => d.id === docId));
  });

  await check("files are served only to people who may see the project, with safe headers (PDF opens, DWG downloads)", async () => {
    const d = (await f.getDocument(eng, docId))!;
    const dwgRev = d.current!.id;
    const pdfRev = d.revisions.find((r) => r.revision === "B")!.id;
    const pdf = await http.serveRevision(eng, pdfRev);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(pdf.headers.get("x-content-type-options"), "nosniff");
    assert.match(pdf.headers.get("content-security-policy") ?? "", /sandbox/);
    const dwg = await http.serveRevision(eng, dwgRev);
    assert.match(dwg.headers.get("content-disposition") ?? "", /^attachment; filename="S-101\.dwg"$/);
    for (const u of [eng2, staff, other]) assert.equal((await http.serveRevision(u, pdfRev)).status, 404, u.id);
    assert.equal((await http.serveRevision(eng, "nope")).status, 404);
  });

  await check("a phone download link works for one file for a short time, and the person's access is checked again when it is used", async () => {
    const d = (await f.getDocument(eng, docId))!;
    const rev = d.revisions[1].id;
    const link = signDocLink({ revisionId: rev, userId: "dc_eng", orgId: "o_dc_a" });
    const who = await http.userFromDocLink(link);
    assert.deepEqual([who?.user.id, who?.revisionId], ["dc_eng", rev]);
    assert.equal((await http.serveRevision(who!.user, who!.revisionId)).status, 200);
    // expired
    assert.equal(await http.userFromDocLink(signDocLink({ revisionId: rev, userId: "dc_eng", orgId: "o_dc_a" }, new Date(Date.now() - 10 * 60_000))), null);
    // a person who cannot see that project gets nothing even with a valid link
    const l2 = await http.userFromDocLink(signDocLink({ revisionId: rev, userId: "dc_eng2", orgId: "o_dc_a" }));
    assert.equal((await http.serveRevision(l2!.user, l2!.revisionId)).status, 404);
    // a link naming a company the person does not belong to
    assert.equal(await http.userFromDocLink(signDocLink({ revisionId: rev, userId: "dc_eng", orgId: "o_dc_b" })), null);
    // removed from the company, deleted, or the company closed
    await q(`DELETE FROM "Membership" WHERE "userId"='dc_view'`);
    assert.equal(await http.userFromDocLink(signDocLink({ revisionId: rev, userId: "dc_view", orgId: "o_dc_a" })), null, "removed from the company");
    await q(`UPDATE "User" SET "deletedAt"=now() WHERE id='dc_buyer'`);
    assert.equal(await http.userFromDocLink(signDocLink({ revisionId: rev, userId: "dc_buyer", orgId: "o_dc_a" })), null, "deleted account");
    await q(`UPDATE "Organization" SET status='CLOSED' WHERE id='o_dc_b'`);
    const lo = signDocLink({ revisionId: "x", userId: "dc_other", orgId: "o_dc_b" });
    assert.equal(await http.userFromDocLink(lo), null, "closed company");
    assert.equal(await http.userFromDocLink("garbage"), null);
  });

  await check("company isolation holds in the database, and every change is logged", async () => {
    assert.equal((await dbFor("o_dc_b").projectDocument.findMany()).length, 0);
    assert.equal((await dbFor("o_dc_b").documentRevision.findMany()).length, 0);
    const actions = (await q<{ action: string }>(`SELECT DISTINCT action FROM "ActivityLog" WHERE action LIKE 'DOCUMENT_%'`)).map((r) => r.action).sort();
    assert.deepEqual(actions, ["DOCUMENT_ADDED", "DOCUMENT_ARCHIVED", "DOCUMENT_REVISION_ADDED"]);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
