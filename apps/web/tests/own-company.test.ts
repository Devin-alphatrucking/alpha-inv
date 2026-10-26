// Database-backed tests of "start a company of your own" for someone who already has an account. Run through `npm run test:isolation`.
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
const ip = () => `198.51.106.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { createInvite, acceptInvite } = await import("@/lib/flows/invite");
  const { createOwnCompany, MAX_OWNED_COMPANIES } = await import("@/lib/flows/company-create");
  const { listMyCompanies } = await import("@/lib/flows/account");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && /Confirm your email/.test(x.subject));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [row] = await q<{ orgId: string; userId: string }>(`SELECT o.id AS "orgId", u.id AS "userId" FROM "Organization" o JOIN "Membership" m ON m."organizationId"=o.id JOIN "User" u ON u.id=m."userId" WHERE u.email=$1`, [email]);
    return row;
  };

  const boss = await makeCompany("Employer Co", "boss@employer.test");
  // An employee: invited into the employer's company as staff.
  assert.ok((await createInvite({ id: boss.userId, name: "Boss", orgId: boss.orgId }, { email: "sam@employee.test", role: "STAFF", projectIds: [] })).ok);
  const inviteMail = mails().filter((m) => m.to === "sam@employee.test").at(-1)!;
  assert.ok((await acceptInvite({ token: /token=([A-Za-z0-9_-]+)/.exec(inviteMail.text)![1], name: "Sam Employee", password: PW, acceptTerms: true }, null)).ok);
  const [sam] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='sam@employee.test'`);

  await check("an employee starts a company of their own: a trial, administrator, starter data, and nothing changes at the employer", async () => {
    const before = await q<{ n: string }>(`SELECT count(*) AS n FROM "Membership" WHERE "organizationId"=$1`, [boss.orgId]);
    const r = await createOwnCompany({ id: sam.id }, { companyName: "Sam Builders", country: "IN" });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    const [org] = await q<{ name: string; status: string; currency: string }>(`SELECT name, status, currency FROM "Organization" WHERE id=$1`, [r.orgId]);
    assert.deepEqual([org.name, org.status, org.currency], ["Sam Builders", "TRIAL", "INR"]);
    const [m] = await q<{ role: string }>(`SELECT role::text FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2`, [sam.id, r.orgId]);
    assert.equal(m.role, "ADMIN");
    const [sub] = await q<{ status: string; quantity: number; trialEndsAt: Date }>(`SELECT status::text, quantity, "trialEndsAt" FROM "Subscription" WHERE "organizationId"=$1`, [r.orgId]);
    assert.deepEqual([sub.status, sub.quantity], ["TRIALING", 1]);
    assert.ok(sub.trialEndsAt.getTime() - Date.now() > 13 * 86_400_000, "a 14-day trial of their own");
    assert.ok(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Category" WHERE "organizationId"=$1`, [r.orgId]))[0].n) > 0);
    assert.equal((await q(`SELECT 1 FROM "ProjectAssignment" WHERE "organizationId"=$1 AND "userId"=$2`, [r.orgId, sam.id])).length, 1);
    // the employer's side is exactly as it was
    assert.equal((await q<{ n: string }>(`SELECT count(*) AS n FROM "Membership" WHERE "organizationId"=$1`, [boss.orgId]))[0].n, before[0].n);
    const [role] = await q<{ role: string }>(`SELECT role::text FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2`, [sam.id, boss.orgId]);
    assert.equal(role.role, "STAFF", "still just staff there");
    const log = await q<{ action: string }>(`SELECT action FROM "ActivityLog" WHERE "organizationId"=$1 AND action='COMPANY_CREATED'`, [r.orgId]);
    assert.equal(log.length, 1);
  });

  await check("the person sees both companies, with the right role in each", async () => {
    const mine = await listMyCompanies(sam.id);
    assert.deepEqual(mine.map((c) => [c.name, c.role]).sort(), [["Employer Co", "STAFF"], ["Sam Builders", "ADMIN"]]);
  });

  await check("the two companies cannot see each other's data", async () => {
    const [own] = await q<{ id: string }>(`SELECT id FROM "Organization" WHERE name='Sam Builders'`);
    await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_own_secret',$1,'Sam Private Supplier')`, [own.id]);
    assert.equal((await dbFor(boss.orgId).vendor.findMany({ where: { name: "Sam Private Supplier" } })).length, 0, "the employer cannot see it");
    assert.equal((await dbFor(own.id).vendor.findMany({ where: { name: "Sam Private Supplier" } })).length, 1);
    const people = await q<{ email: string }>(`SELECT u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."organizationId"=$1`, [own.id]);
    assert.deepEqual(people.map((p) => p.email), ["sam@employee.test"], "the employer's people are not in it");
  });

  await check("bad input and an unconfirmed or deleted account are refused, and nothing is created", async () => {
    const orgs = async () => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "Organization"`))[0].n);
    const before = await orgs();
    assert.equal((await createOwnCompany({ id: sam.id }, { companyName: "A", country: "IN" })).ok, false);
    assert.equal((await createOwnCompany({ id: sam.id }, { companyName: "x".repeat(81), country: "IN" })).ok, false);
    assert.equal((await createOwnCompany({ id: sam.id }, { companyName: "Valid Name", country: "ZZ" })).ok, false);
    assert.equal((await createOwnCompany({ id: sam.id }, null)).ok, false);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","updatedAt") VALUES ('u_unconf','Unconfirmed','unconf@employee.test','x',now())`);
    const un = await createOwnCompany({ id: "u_unconf" }, { companyName: "Unconfirmed Co", country: "IN" });
    assert.ok(!un.ok && /Confirm your email/.test(un.error));
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","deletedAt","updatedAt") VALUES ('u_gone','Gone','gone@employee.test','x',now(),now(),now())`);
    assert.equal((await createOwnCompany({ id: "u_gone" }, { companyName: "Gone Co", country: "IN" })).ok, false);
    assert.equal((await createOwnCompany({ id: "no-such-user" }, { companyName: "Ghost Co", country: "IN" })).ok, false);
    assert.equal(await orgs(), before);
  });

  await check("the same company name twice gets different company codes", async () => {
    const [other] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='boss@employer.test'`);
    const a = await createOwnCompany({ id: other.id }, { companyName: "Twin Holdings", country: "AU" });
    const b = await createOwnCompany({ id: other.id }, { companyName: "Twin Holdings", country: "AU" });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    const rows = await q<{ slug: string; currency: string }>(`SELECT slug, currency FROM "Organization" WHERE id IN ($1,$2)`, [a.orgId, b.orgId]);
    assert.equal(new Set(rows.map((r) => r.slug)).size, 2);
    assert.ok(rows.every((r) => r.currency === "AUD"), "the country sets the currency");
  });

  await check("only 3 companies a day can be started (each begins a free trial)", async () => {
    const [other] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email='boss@employer.test'`);
    // the boss has already started two above; one more is allowed, then the day's limit is reached
    const third = await createOwnCompany({ id: other.id }, { companyName: "Third Co", country: "IN" });
    assert.ok(third.ok, JSON.stringify(third));
    const fourth = await createOwnCompany({ id: other.id }, { companyName: "Fourth Co", country: "IN" });
    assert.ok(!fourth.ok && /3 companies a day/.test(fourth.error));
  });

  await check("one person cannot run more than five companies", async () => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ('u_many','Many','many@employee.test','x',now(),now())`);
    for (let i = 0; i < MAX_OWNED_COMPANIES; i++) {
      await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ($1,$2,$3,'TRIAL',now())`, [`o_many_${i}`, `Many ${i}`, `many-${i}`]);
      await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,'u_many',$2,'ADMIN')`, [`m_many_${i}`, `o_many_${i}`]);
    }
    const r = await createOwnCompany({ id: "u_many" }, { companyName: "One Too Many", country: "IN" });
    assert.ok(!r.ok && /most one person/.test(r.error));
    // a company that was closed no longer counts
    await q(`UPDATE "Organization" SET status='CLOSED' WHERE id='o_many_0'`);
    assert.ok((await createOwnCompany({ id: "u_many" }, { companyName: "Room Again", country: "IN" })).ok);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
