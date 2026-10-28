// Database-backed tests of the new roles: inviting with each role, what an invited person gets, and which invoices each role sees.
// Run through `npm run test:isolation`.
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
let ipCounter = 160;
const ip = () => `198.51.104.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { createInvite, acceptInvite } = await import("@/lib/flows/invite");
  const { invoiceAccessWhere } = await import("@/lib/invoices/access");
  const { projectAccessWhere } = await import("@/lib/projects/access");
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { ROLES } = await import("@/lib/roles");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  assert.ok((await signUp({ companyName: "Role Co", name: "Role Admin", email: "admin@role-co.test", password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
  const found = mails().filter((x) => x.to === "admin@role-co.test" && x.subject.includes("Confirm your email"));
  assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
  const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email='admin@role-co.test'`);
  const admin = { id: row.userId, name: "Role Admin", orgId: row.orgId };
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_role',$1,'Role Vendor')`, [row.orgId]);
  await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ('p_role_a',$1,'Site A','ACTIVE',now()),('p_role_b',$1,'Site B','ACTIVE',now())`, [row.orgId]);
  const addInvoice = async (id: string, projectId: string, uploadedById: string | null = null) =>
    q(`INSERT INTO "Invoice"(id,"organizationId","invoiceNumber","projectId","vendorId","invoiceDate",subtotal,total,status,"fileUrl","uploadedById","updatedAt") VALUES ($1,$2,$3,$4,'v_role','2026-09-01'::timestamp,100,100,'UNPAID','x',$5,now())`, [id, row.orgId, id, projectId, uploadedById]);
  await addInvoice("inv_a", "p_role_a");
  await addInvoice("inv_b", "p_role_b");

  // The plan allows five people: use a generous override so every role can be invited.
  await q(`UPDATE "Subscription" SET overrides = '{"extraProjects":0,"extraUsers":20,"aiPagesPerProject":null}'::jsonb WHERE "organizationId"=$1`, [row.orgId]);

  const people: Record<string, { id: string; email: string }> = {};
  async function invite(role: string, projectIds: string[]) {
    const email = `${role.toLowerCase()}@role-co.test`;
    const r = await createInvite(admin, { email, role, projectIds });
    assert.ok(r.ok, JSON.stringify(r));
    const mail = mails().filter((m) => m.to === email).at(-1)!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const done = await acceptInvite({ token, name: `${role} Person`, password: PW, phone: "9876543210", acceptTerms: true }, null);
    assert.ok(done.ok, JSON.stringify(done));
    const [u] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    people[role] = { id: u.id, email };
    return u.id;
  }

  await check("every role can be invited and accepted, and is stored as that role in the company", async () => {
    for (const role of ROLES.filter((r) => r !== "ADMIN")) await invite(role, ["p_role_a"]);
    const rows = await q<{ role: string }>(`SELECT m.role::text AS role FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND u.email LIKE '%@role-co.test' AND u.email <> 'admin@role-co.test' ORDER BY 1`, [row.orgId]);
    assert.deepEqual(rows.map((r) => r.role).sort(), ["ACCOUNTANT", "ENGINEER", "MANAGER", "PURCHASE", "STAFF", "VIEWER"]);
  });

  await check("roles that see every project get no project assignments; the others get the ones chosen", async () => {
    const assigned = async (role: string) => (await q<{ projectId: string }>(`SELECT "projectId" FROM "ProjectAssignment" WHERE "userId"=$1 AND "organizationId"=$2`, [people[role].id, row.orgId])).map((r) => r.projectId);
    assert.deepEqual(await assigned("ACCOUNTANT"), [], "the accountant sees everything, so nothing to assign");
    for (const role of ["PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"]) assert.deepEqual(await assigned(role), ["p_role_a"], role);
  });

  await check("which invoices and projects each role can see", async () => {
    const db = dbFor(row.orgId);
    const seen = async (role: string) => (await db.invoice.findMany({ where: invoiceAccessWhere({ id: people[role].id, role: role as never, orgId: row.orgId }), select: { id: true }, orderBy: { id: "asc" } })).map((i) => i.id);
    assert.deepEqual(await seen("ACCOUNTANT"), ["inv_a", "inv_b"]);
    for (const role of ["PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"]) assert.deepEqual(await seen(role), ["inv_a"], role);
    const projects = async (role: string) => (await db.project.findMany({ where: projectAccessWhere({ id: people[role].id, role: role as never, orgId: row.orgId }), select: { id: true }, orderBy: { id: "asc" } })).filter((p) => p.id.startsWith("p_role")).map((p) => p.id);
    assert.deepEqual(await projects("ACCOUNTANT"), ["p_role_a", "p_role_b"]);
    assert.deepEqual(await projects("VIEWER"), ["p_role_a"]);
  });

  await check("a person's own uploads stay visible to them even outside their project", async () => {
    await addInvoice("inv_own", "p_role_b", people.ENGINEER.id);
    const db = dbFor(row.orgId);
    const ids = (await db.invoice.findMany({ where: invoiceAccessWhere({ id: people.ENGINEER.id, role: "ENGINEER", orgId: row.orgId }), select: { id: true } })).map((i) => i.id).sort();
    assert.deepEqual(ids, ["inv_a", "inv_own"]);
  });

  await check("an unknown role is refused when inviting", async () => {
    const r = await createInvite(admin, { email: "boss@role-co.test", role: "OWNER", projectIds: [] });
    assert.equal(r.ok, false);
    assert.equal((await q(`SELECT 1 FROM "AuthToken" WHERE email='boss@role-co.test'`)).length, 0);
  });

  await check("the database holds all seven roles", async () => {
    const rows = await q<{ v: string }>(`SELECT unnest(enum_range(NULL::"Role"))::text AS v`);
    assert.deepEqual(rows.map((r) => r.v).sort(), [...ROLES].sort());
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
