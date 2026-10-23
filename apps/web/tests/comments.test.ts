// Database-backed tests of invoice comments. Run through `npm run test:isolation`.
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
let ipCounter = 200;
const ip = () => `203.0.118.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { addComment, deleteComment, listComments } = await import("@/lib/flows/comments");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ($1,$2,'Comment Vendor')`, [`v_${row.orgId}`, row.orgId]);
    await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,'Project One','ACTIVE',now()), ($3,$2,'Project Two','ACTIVE',now())`, [`p1_${row.orgId}`, row.orgId, `p2_${row.orgId}`]);
    return { orgId: row.orgId, adminId: row.userId, vendorId: `v_${row.orgId}`, p1: `p1_${row.orgId}`, p2: `p2_${row.orgId}` };
  };
  type Co = Awaited<ReturnType<typeof makeCompany>>;
  let n = 0;
  const addStaff = async (c: Co, email: string, assignedProject: string | null) => {
    const id = `u_cm_${++n}`;
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, email, email]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,'STAFF')`, [`m_cm_${++n}`, id, c.orgId]);
    if (assignedProject) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,$2,$3,$4)`, [`pa_cm_${++n}`, c.orgId, id, assignedProject]);
    return { id, role: "STAFF" as const, orgId: c.orgId };
  };
  const addInvoice = async (c: Co, projectId: string, uploadedById: string | null = null) => {
    const id = `i_cm_${++n}`;
    await q(
      `INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","uploadedById","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'2026-09-01'::timestamp,100,100,'UNPAID','x',$6,now())`,
      [id, c.orgId, `CM-${n}`, projectId, c.vendorId, uploadedById],
    );
    return id;
  };

  const a = await makeCompany("Comment Alpha", "admin@comment-alpha.test");
  const b = await makeCompany("Comment Beta", "admin@comment-beta.test");
  const admin = { id: a.adminId, role: "ADMIN" as const, orgId: a.orgId };
  const adminB = { id: b.adminId, role: "ADMIN" as const, orgId: b.orgId };
  const staff1 = await addStaff(a, "staff1@comment-alpha.test", a.p1); // assigned to project one
  const staff2 = await addStaff(a, "staff2@comment-alpha.test", a.p2); // assigned to project two
  const invOne = await addInvoice(a, a.p1);
  const invTwo = await addInvoice(a, a.p2);
  const invBeta = await addInvoice(b, b.p1);

  await check("a comment is saved with its author and listed oldest first", async () => {
    const first = await addComment(admin, invOne, "  Query raised with the vendor  ");
    assert.ok(first.ok);
    await new Promise((r) => setTimeout(r, 15));
    assert.ok((await addComment(staff1, invOne, "Vendor replied: credit note coming")).ok);
    const list = await listComments(admin, invOne);
    assert.deepEqual(list.map((c) => c.body), ["Query raised with the vendor", "Vendor replied: credit note coming"]);
    assert.deepEqual(list.map((c) => c.authorName), ["Comment Alpha Admin", "staff1@comment-alpha.test"]);
    assert.deepEqual(list.map((c) => c.mine), [true, false], "mine is from the viewer's side");
  });

  await check("empty, blank and over-long comments are refused and nothing is saved", async () => {
    for (const bad of ["", "   ", "x".repeat(2001)]) {
      const r = await addComment(admin, invOne, bad);
      assert.equal(r.ok, false);
    }
    assert.equal((await listComments(admin, invOne)).length, 2);
  });

  await check("staff see and write comments only on invoices they can see", async () => {
    // staff2 is on project two: cannot see invoice one, can see invoice two
    assert.deepEqual(await listComments(staff2, invOne), []);
    const refused = await addComment(staff2, invOne, "Sneaking in");
    assert.deepEqual([refused.ok, !refused.ok && refused.error], [false, "Invoice not found."]);
    assert.ok((await addComment(staff2, invTwo, "Fine here")).ok);
    assert.equal((await listComments(admin, invOne)).length, 2, "nothing was added to invoice one");
    // an invoice staff1 uploaded themself is visible even outside their project
    const own = await addInvoice(a, a.p2, staff1.id);
    assert.ok((await addComment(staff1, own, "My own upload")).ok);
  });

  await check("only the author or an administrator can remove a comment", async () => {
    const [mine] = (await listComments(staff1, invOne)).filter((c) => c.mine);
    const [adminsOwn] = (await listComments(staff1, invOne)).filter((c) => !c.mine);
    assert.equal(mine.canDelete, true);
    assert.equal(adminsOwn.canDelete, false, "staff cannot remove the administrator's comment");
    const refused = await deleteComment(staff1, adminsOwn.id);
    assert.equal(refused.ok, false);
    assert.equal((await listComments(admin, invOne)).length, 2);
    assert.ok((await deleteComment(staff1, mine.id)).ok, "the author removes their own");
    assert.ok((await deleteComment(admin, adminsOwn.id)).ok, "an administrator removes any");
    assert.equal((await listComments(admin, invOne)).length, 0);
  });

  await check("someone who cannot see the invoice cannot remove its comments or learn they exist", async () => {
    const added = await addComment(admin, invOne, "Private to project one");
    assert.ok(added.ok);
    const r = await deleteComment(staff2, added.ok ? added.id : "");
    assert.deepEqual([r.ok, !r.ok && r.error], [false, "Comment not found."]);
    assert.equal((await listComments(admin, invOne)).length, 1);
  });

  await check("another company can neither read, write nor remove them", async () => {
    const [mineA] = await listComments(admin, invOne);
    assert.deepEqual(await listComments(adminB, invOne), []);
    assert.equal((await addComment(adminB, invOne, "Cross-company")).ok, false);
    const r = await deleteComment(adminB, mineA.id);
    assert.equal(r.ok, false);
    assert.equal((await listComments(admin, invOne)).length, 1);
    assert.ok((await addComment(adminB, invBeta, "Beta's own")).ok);
    assert.deepEqual((await listComments(adminB, invBeta)).map((c) => c.body), ["Beta's own"]);
  });

  await check("deleting the invoice removes its comments; removing the author keeps them as a former member's", async () => {
    const inv = await addInvoice(a, a.p1);
    assert.ok((await addComment(staff1, inv, "From staff one")).ok);
    await q(`DELETE FROM "ProjectAssignment" WHERE "userId"=$1`, [staff1.id]);
    await q(`DELETE FROM "Membership" WHERE "userId"=$1`, [staff1.id]);
    await q(`DELETE FROM "Invoice" WHERE "uploadedById"=$1`, [staff1.id]);
    await q(`DELETE FROM "User" WHERE id=$1`, [staff1.id]);
    const list = await listComments(admin, inv);
    assert.equal(list.length, 1);
    assert.equal(list[0].authorName, "Former member");
    assert.equal(list[0].canDelete, true, "an administrator can still tidy it");
    await q(`DELETE FROM "Invoice" WHERE id=$1`, [inv]);
    assert.equal((await q(`SELECT 1 FROM "InvoiceComment" WHERE "invoiceId"=$1`, [inv])).length, 0);
  });

  await check("the activity log records who added and removed comments", async () => {
    const rows = await q<{ action: string }>(`SELECT action FROM "ActivityLog" WHERE "organizationId"=$1 AND action IN ('INVOICE_COMMENT_ADDED','INVOICE_COMMENT_DELETED')`, [a.orgId]);
    assert.ok(rows.some((r) => r.action === "INVOICE_COMMENT_ADDED"));
    assert.ok(rows.some((r) => r.action === "INVOICE_COMMENT_DELETED"));
  });

  await check("a flood of comments is slowed down", async () => {
    const inv = await addInvoice(a, a.p1);
    let refused = 0;
    for (let i = 0; i < 35; i++) {
      const r = await addComment(admin, inv, `note ${i}`);
      if (!r.ok) refused++;
    }
    assert.ok(refused >= 1, "the limit of 30 per 10 minutes stops the rest");
    assert.ok((await listComments(admin, inv)).length <= 30);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
