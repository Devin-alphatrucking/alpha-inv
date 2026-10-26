// Database-backed tests of the account rules behind "Sign in with Google". Run through `npm run test:isolation`.
// (The round trip to Google itself needs real credentials and is not covered here.)
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

async function main() {
  const g = await import("@/lib/flows/google");
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  await check("Google is offered only when both credentials are set", () => {
    const keep = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET];
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal(g.isGoogleConfigured(), false);
    process.env.GOOGLE_CLIENT_ID = "id";
    assert.equal(g.isGoogleConfigured(), false);
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    assert.equal(g.isGoogleConfigured(), true);
    process.env.GOOGLE_CLIENT_ID = keep[0] ?? "";
    process.env.GOOGLE_CLIENT_SECRET = keep[1] ?? "";
  });

  await check("an address Google has not confirmed, or no address at all, is refused and nothing is created", async () => {
    const before = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "User"`))[0].n);
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "x@g.test", email_verified: false, name: "X" }), { ok: false, reason: "unverified" });
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "x@g.test", name: "X" }), { ok: false, reason: "unverified" });
    assert.deepEqual(await g.resolveGoogleSignIn({ email_verified: true }), { ok: false, reason: "bad_profile" });
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "not-an-email", email_verified: true }), { ok: false, reason: "bad_profile" });
    assert.equal(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "User"`))[0].n), before);
  });

  let newUserId = "";
  await check("a new person gets a confirmed account and a company of their own on a free trial", async () => {
    const r = await g.resolveGoogleSignIn({ email: "  Asha.Rao@Gmail.test ", email_verified: true, name: "Asha Rao" });
    assert.ok(r.ok && r.created, JSON.stringify(r));
    if (!r.ok) return;
    newUserId = r.userId;
    const [u] = await q<{ email: string; name: string; emailVerifiedAt: Date | null; termsAcceptedAt: Date | null; passwordHash: string }>(`SELECT email, name, "emailVerifiedAt", "termsAcceptedAt", "passwordHash" FROM "User" WHERE id=$1`, [r.userId]);
    assert.deepEqual([u.email, u.name], ["asha.rao@gmail.test", "Asha Rao"], "address is stored in lower case");
    assert.ok(u.emailVerifiedAt && u.termsAcceptedAt);
    assert.ok(u.passwordHash.length > 20, "has a random password nobody knows");
    const [m] = await q<{ role: string; name: string; status: string }>(`SELECT m.role::text, o.name, o.status::text FROM "Membership" m JOIN "Organization" o ON o.id=m."organizationId" WHERE m."userId"=$1`, [r.userId]);
    assert.deepEqual([m.role, m.name, m.status], ["ADMIN", "Asha's company", "TRIAL"]);
    const [sub] = await q<{ status: string }>(`SELECT s.status::text FROM "Subscription" s JOIN "Membership" m ON m."organizationId"=s."organizationId" WHERE m."userId"=$1`, [r.userId]);
    assert.equal(sub.status, "TRIALING");
    assert.equal((await q(`SELECT 1 FROM "ActivityLog" WHERE "userId"=$1 AND action='USER_SIGNED_UP' AND details->>'via'='google'`, [r.userId])).length, 1);
  });

  await check("the same person again, in any letter case, signs in to the same account (no second company)", async () => {
    const r = await g.resolveGoogleSignIn({ email: "ASHA.RAO@gmail.test", email_verified: true, name: "Someone Else" });
    assert.ok(r.ok && !r.created && r.userId === newUserId);
    assert.equal((await q(`SELECT 1 FROM "Membership" WHERE "userId"=$1`, [newUserId])).length, 1);
    const s = await g.googleSessionUser("Asha.Rao@gmail.test");
    assert.ok(s && s.id === newUserId && s.role === "ADMIN" && s.orgId);
    assert.equal(s?.name, "Asha Rao", "the name comes from our records, not from what Google sends");
  });

  await check("someone who signed up with a password but never confirmed their email is confirmed by Google (it proves the address)", async () => {
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_g1','Pw Co','pw-co','TRIAL',now())`);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","updatedAt") VALUES ('u_g1','Pw','pw@gmail.test','x',now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_g1','u_g1','o_g1','ADMIN')`);
    assert.equal(await g.googleSessionUser("pw@gmail.test"), null, "not confirmed yet: no session");
    const r = await g.resolveGoogleSignIn({ email: "pw@gmail.test", email_verified: true, name: "Pw" });
    assert.ok(r.ok && !r.created && r.userId === "u_g1");
    assert.ok((await q<{ v: Date | null }>(`SELECT "emailVerifiedAt" AS v FROM "User" WHERE id='u_g1'`))[0].v);
    assert.ok(await g.googleSessionUser("pw@gmail.test"));
  });

  await check("two-step sign-in cannot be skipped with Google", async () => {
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_g2','Totp Co','totp-co','TRIAL',now())`);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","totpEnabledAt","totpSecretEnc","updatedAt") VALUES ('u_g2','Totp','totp@gmail.test','x',now(),now(),'enc',now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_g2','u_g2','o_g2','ADMIN')`);
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "totp@gmail.test", email_verified: true, name: "T" }), { ok: false, reason: "two_step" });
    assert.equal(await g.googleSessionUser("totp@gmail.test"), null);
  });

  await check("a deleted account, and an account whose only company is closed or suspended, cannot sign in", async () => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","deletedAt","updatedAt") VALUES ('u_g3','Gone','gone@gmail.test','x',now(),now(),now())`);
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "gone@gmail.test", email_verified: true, name: "G" }), { ok: false, reason: "deleted" });
    await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_g4','Closed Co','closed-co','CLOSED',now())`);
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ('u_g4','Closed','closed@gmail.test','x',now(),now())`);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('m_g4','u_g4','o_g4','ADMIN')`);
    assert.deepEqual(await g.resolveGoogleSignIn({ email: "closed@gmail.test", email_verified: true, name: "C" }), { ok: false, reason: "no_company" });
    assert.equal(await g.googleSessionUser("closed@gmail.test"), null);
    assert.equal(await g.googleSessionUser(null), null);
    assert.equal(await g.googleSessionUser("nobody@gmail.test"), null);
  });

  await check("every refusal has a plain message that does not say whether an account exists", async () => {
    const { GOOGLE_MESSAGES } = await import("@/lib/flows/google-messages");
    for (const k of ["unverified", "two_step", "deleted", "no_company", "busy", "bad_profile", "failed"] as const) assert.ok(GOOGLE_MESSAGES[k].length > 10, k);
    assert.ok(!/exist|register|found/i.test(GOOGLE_MESSAGES.deleted));
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
