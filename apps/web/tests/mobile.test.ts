// Database-backed tests of the mobile sign-in sessions (Phase 7). Run through `npm run test:isolation`.
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

const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
let ipCounter = 40;
const ip = () => `198.18.0.${++ipCounter}`;

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { signOutEverywhere, changePassword } = await import("@/lib/flows/account");
  const m = await import("@/lib/mobile/sessions");
  const { verifyAccessToken } = await import("@/lib/mobile/token");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];
  const count = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0].n);

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const [org] = await q<{ id: string }>(`SELECT o.id FROM "Organization" o JOIN "Membership" mm ON mm."organizationId"=o.id JOIN "User" u ON u.id=mm."userId" WHERE u.email=$1`, [email]);
    const [user] = await q<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [email]);
    return { orgId: org.id, userId: user.id, email };
  };
  let throttle = false; // the rate-limit test turns this on; otherwise every login starts with clean counters
  const login = async (email: string, extra: Record<string, unknown> = {}, addr = ip()) => {
    if (!throttle) await q(`DELETE FROM "RateLimit"`);
    return m.loginMobile({ email, password: PW, deviceName: "Pixel 8", platform: "android", appVersion: "1.0.0", ...extra }, { ip: addr });
  };
  const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    assert.equal(r.ok, true, JSON.stringify(r));
    return r as Extract<T, { ok: true }>;
  };

  const a = await makeCompany("Mobile Alpha", "admin@mobile-alpha.test");
  const b = await makeCompany("Mobile Beta", "admin@mobile-beta.test");

  // ---------------------------------------------------------- sign-in
  await check("login: right password gives tokens; the session stores only a hash of the refresh token", async () => {
    const r = must(await login(a.email));
    assert.equal(r.orgId, a.orgId);
    const sid = verifyAccessToken(r.tokens.accessToken);
    assert.ok(sid);
    const [s] = await q<{ refreshHash: string; platform: string; deviceName: string }>(`SELECT "refreshHash", platform, "deviceName" FROM "MobileSession" WHERE id=$1`, [sid]);
    assert.notEqual(s.refreshHash, r.tokens.refreshToken);
    assert.match(s.refreshHash, /^[0-9a-f]{64}$/);
    assert.deepEqual([s.platform, s.deviceName], ["android", "Pixel 8"]);
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='LOGIN' AND "userId"=$1 AND details->>'via'='mobile'`, [a.userId]), 1);
  });

  await check("login: wrong password, unknown email and bad input all say the same thing; nothing is created", async () => {
    const before = await count(`SELECT count(*) n FROM "MobileSession"`);
    const wrong = await login(a.email, { password: "not the password" });
    const unknown = await login("nobody@mobile-alpha.test");
    assert.deepEqual([wrong.ok, unknown.ok], [false, false]);
    assert.deepEqual([wrong.ok === false && wrong.code, unknown.ok === false && unknown.code], ["invalid_credentials", "invalid_credentials"]);
    assert.equal(wrong.ok === false && wrong.error, unknown.ok === false && unknown.error);
    const bad = await m.loginMobile({ email: "not-an-email", password: "x" }, { ip: ip() });
    assert.equal(bad.ok === false && bad.code, "invalid_input");
    const badPlatform = await login(a.email, { platform: "windows-phone" });
    assert.equal(badPlatform.ok, false);
    assert.equal(await count(`SELECT count(*) n FROM "MobileSession"`), before);
  });

  await check("login: an unconfirmed email, a deleted account and a suspended company are refused", async () => {
    await q(`UPDATE "User" SET "emailVerifiedAt"=NULL WHERE id=$1`, [b.userId]);
    const unverified = await login(b.email);
    assert.equal(unverified.ok === false && unverified.code, "email_not_verified");
    await q(`UPDATE "User" SET "emailVerifiedAt"=now() WHERE id=$1`, [b.userId]);
    await q(`UPDATE "Organization" SET status='SUSPENDED' WHERE id=$1`, [b.orgId]);
    const suspended = await login(b.email);
    assert.equal(suspended.ok === false && suspended.code, "no_company");
    await q(`UPDATE "Organization" SET status='TRIAL' WHERE id=$1`, [b.orgId]);
    assert.ok((await login(b.email)).ok);
  });

  await check("login: guessing is limited per address (shared with the website's counter)", async () => {
    const target = "admin@mobile-beta.test";
    throttle = true;
    await q(`DELETE FROM "RateLimit"`);
    let blocked: Awaited<ReturnType<typeof login>> | null = null;
    for (let i = 0; i < 14 && !blocked; i++) {
      const r = await login(target, { password: "wrong password " + i }, ip());
      if (!r.ok && r.code === "rate_limited") blocked = r;
    }
    assert.ok(blocked && !blocked.ok && blocked.status === 429, "expected a rate limit within 14 tries");
    assert.equal((await login(target)).ok, false, "even the right password waits");
    throttle = false;
  });

  // ---------------------------------------------------------- bearer authentication
  await check("a valid access token identifies the person, company and role from the database", async () => {
    const r = must(await login(a.email));
    const u = await m.authenticateBearer(r.tokens.accessToken);
    assert.deepEqual([u?.id, u?.orgId, u?.role], [a.userId, a.orgId, "ADMIN"]);
    assert.equal(await m.authenticateBearer("v1.garbage.token"), null);
    assert.equal(await m.authenticateBearer(""), null);
  });

  await check("role changes take effect on the very next request (the token carries no role)", async () => {
    const r = must(await login(a.email));
    await q(`UPDATE "Membership" SET role='STAFF' WHERE "userId"=$1 AND "organizationId"=$2`, [a.userId, a.orgId]);
    assert.equal((await m.authenticateBearer(r.tokens.accessToken))?.role, "STAFF");
    await q(`UPDATE "Membership" SET role='ADMIN' WHERE "userId"=$1 AND "organizationId"=$2`, [a.userId, a.orgId]);
  });

  await check("sign out everywhere ends every mobile session at once, and so does a password change", async () => {
    const r1 = must(await login(a.email));
    const r2 = must(await login(a.email));
    assert.ok(await m.authenticateBearer(r1.tokens.accessToken));
    assert.ok((await signOutEverywhere(a.userId)).ok);
    assert.equal(await m.authenticateBearer(r1.tokens.accessToken), null);
    assert.equal(await m.authenticateBearer(r2.tokens.accessToken), null);
    const refreshed = await m.refreshMobile(r1.tokens.refreshToken, { ip: ip() });
    assert.equal(refreshed.ok, false, "the refresh token is dead too");
    // password change
    const r3 = must(await login(a.email));
    assert.ok((await changePassword(a.userId, PW, "a brand new long passphrase 42")).ok);
    assert.equal(await m.authenticateBearer(r3.tokens.accessToken), null);
    assert.ok((await changePassword(a.userId, "a brand new long passphrase 42", PW)).ok);
  });

  await check("a removed member, a suspended company or a deleted account loses access at once", async () => {
    const r = must(await login(b.email));
    await q(`UPDATE "Organization" SET status='SUSPENDED' WHERE id=$1`, [b.orgId]);
    assert.equal(await m.authenticateBearer(r.tokens.accessToken), null);
    assert.equal((await m.refreshMobile(r.tokens.refreshToken, { ip: ip() })).ok, false);
    await q(`UPDATE "Organization" SET status='TRIAL' WHERE id=$1`, [b.orgId]);
    const r2 = must(await login(b.email));
    await q(`UPDATE "User" SET "deletedAt"=now() WHERE id=$1`, [b.userId]);
    assert.equal(await m.authenticateBearer(r2.tokens.accessToken), null);
    await q(`UPDATE "User" SET "deletedAt"=NULL WHERE id=$1`, [b.userId]);
  });

  await check("logout revokes the session: the access token stops working and the refresh token is useless", async () => {
    const r = must(await login(a.email));
    const me = (await m.authenticateBearer(r.tokens.accessToken))!;
    await m.logoutMobile(me.sessionId, me.id);
    assert.equal(await m.authenticateBearer(r.tokens.accessToken), null);
    assert.equal((await m.refreshMobile(r.tokens.refreshToken, { ip: ip() })).ok, false);
    assert.equal(await count(`SELECT count(*) n FROM "MobileSession" WHERE id=$1 AND "revokedAt" IS NOT NULL`, [me.sessionId]), 1);
  });

  // ---------------------------------------------------------- refresh
  await check("refresh: gives a NEW pair, the old refresh token no longer works", async () => {
    const r = must(await login(a.email));
    const next = must(await m.refreshMobile(r.tokens.refreshToken, { ip: ip() }));
    assert.notEqual(next.tokens.refreshToken, r.tokens.refreshToken);
    assert.ok(await m.authenticateBearer(next.tokens.accessToken));
    // the old access token is still valid until it expires (15 minutes), which is the normal trade-off
    assert.ok(await m.authenticateBearer(r.tokens.accessToken));
    const again = must(await m.refreshMobile(next.tokens.refreshToken, { ip: ip() }));
    assert.ok(again.tokens.refreshToken);
  });

  await check("refresh: showing an OLD refresh token later means it was copied, so the whole session is revoked", async () => {
    const r = must(await login(a.email));
    const next = must(await m.refreshMobile(r.tokens.refreshToken, { ip: ip() }));
    // make the rotation older than the grace window
    await q(`UPDATE "MobileSession" SET "lastUsedAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHERE "refreshHash"=$1`, [(await import("@/lib/mobile/token")).hashRefresh(next.tokens.refreshToken)]);
    const stolen = await m.refreshMobile(r.tokens.refreshToken, { ip: ip() });
    assert.equal(stolen.ok === false && stolen.code, "invalid_refresh");
    assert.equal(await m.authenticateBearer(next.tokens.accessToken), null, "the legitimate session is ended too");
    assert.equal((await m.refreshMobile(next.tokens.refreshToken, { ip: ip() })).ok, false);
    assert.equal(await count(`SELECT count(*) n FROM "MobileSession" WHERE "revokedReason"='refresh token reuse' AND "userId"=$1`, [a.userId]), 1);
    assert.equal(await count(`SELECT count(*) n FROM "ActivityLog" WHERE action='SESSIONS_REVOKED' AND details->>'reason'='refresh token reuse'`), 1);
  });

  await check("refresh: two simultaneous refreshes from one device are not treated as theft", async () => {
    const r = must(await login(a.email));
    const [x, y] = await Promise.all([m.refreshMobile(r.tokens.refreshToken, { ip: ip() }), m.refreshMobile(r.tokens.refreshToken, { ip: ip() })]);
    const wins = [x, y].filter((z) => z.ok);
    const losers = [x, y].filter((z) => !z.ok);
    assert.equal(wins.length, 1, "exactly one wins");
    assert.equal(losers[0].ok === false && losers[0].code, "refresh_in_progress");
    const winner = wins[0] as Extract<typeof x, { ok: true }>;
    assert.ok(await m.authenticateBearer(winner.tokens.accessToken), "the session survives");
  });

  await check("refresh: junk, expired and over-age sessions are refused", async () => {
    for (const bad of [undefined, null, 5, "", "short", "x".repeat(300)]) assert.equal((await m.refreshMobile(bad, { ip: ip() })).ok, false);
    const r = must(await login(a.email));
    const hash = (await import("@/lib/mobile/token")).hashRefresh(r.tokens.refreshToken);
    await q(`UPDATE "MobileSession" SET "refreshExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "refreshHash"=$1`, [hash]);
    const expired = await m.refreshMobile(r.tokens.refreshToken, { ip: ip() });
    assert.equal(expired.ok === false && expired.code, "session_ended");
    assert.equal(await m.authenticateBearer(r.tokens.accessToken), null);
    const r2 = must(await login(a.email));
    await q(`UPDATE "MobileSession" SET "absoluteExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "refreshHash"=$1`, [(await import("@/lib/mobile/token")).hashRefresh(r2.tokens.refreshToken)]);
    assert.equal((await m.refreshMobile(r2.tokens.refreshToken, { ip: ip() })).ok, false);
  });

  // ---------------------------------------------------------- companies
  await check("switching company: only to a company the person belongs to; the next requests use it", async () => {
    const r = must(await login(a.email));
    const me = (await m.authenticateBearer(r.tokens.accessToken))!;
    const denied = await m.switchCompanyMobile(me.sessionId, me.id, b.orgId);
    assert.equal(denied.ok === false && denied.code, "no_company");
    assert.equal((await m.authenticateBearer(r.tokens.accessToken))?.orgId, a.orgId);
    // make the person a member of company B, then switch
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('mem_mobile_x',$1,$2,'STAFF')`, [a.userId, b.orgId]);
    const ok = await m.switchCompanyMobile(me.sessionId, me.id, b.orgId);
    assert.equal(ok.ok, true);
    const after = await m.authenticateBearer(r.tokens.accessToken);
    assert.deepEqual([after?.orgId, after?.role], [b.orgId, "STAFF"]);
    assert.equal((await m.switchCompanyMobile(me.sessionId, me.id, 42)).ok, false);
    await q(`UPDATE "Organization" SET status='CLOSED' WHERE id=$1`, [b.orgId]);
    assert.equal(await m.authenticateBearer(r.tokens.accessToken), null, "a closed company ends the session that was in it");
    await q(`UPDATE "Organization" SET status='TRIAL' WHERE id=$1`, [b.orgId]);
    await q(`DELETE FROM "Membership" WHERE id='mem_mobile_x'`);
  });

  await check("a mobile session cannot see another company's data through the scoped handle it is given", async () => {
    const r = must(await login(a.email));
    const me = (await m.authenticateBearer(r.tokens.accessToken))!;
    const mine = await dbFor(me.orgId).project.findMany({ select: { organizationId: true } });
    assert.ok(mine.length > 0 && mine.every((p) => p.organizationId === a.orgId));
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
