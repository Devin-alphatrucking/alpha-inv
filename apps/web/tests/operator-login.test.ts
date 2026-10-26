// Database-backed tests of the master console's own sign-in: who can use it, its limits, and its alerts. Run through `npm run test:isolation`.
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

type Mail = { to: string; subject: string; text: string };
const mails = (): Mail[] => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail) : []);

async function main() {
  process.env.SECURITY_ALERT_EMAIL = "security@owner.test";
  const { operatorLogin } = await import("@/lib/flows/operator-login");
  const { hashPassword } = await import("@/lib/security/password");
  const { encryptSecret } = await import("@/lib/crypto");
  const { generateSecret, totpAt } = await import("@/lib/security/totp");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];

  const PW = "operator-password-12345";
  const hash = await hashPassword(PW);
  await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_op','Ops Co','ops-co','ACTIVE',now())`);
  const secrets: Record<string, string> = {};
  const person = async (id: string, opts: { operator: boolean; totp: boolean; deleted?: boolean }) => {
    const secret = generateSecret();
    secrets[id] = secret;
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","isPlatformAdmin","totpSecretEnc","totpEnabledAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,now())`, [id, id, `${id}@ops.test`, hash, opts.operator, opts.totp ? encryptSecret(secret) : null, opts.totp ? new Date() : null, opts.deleted ? new Date() : null]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,'o_op','ADMIN')`, [`m_${id}`, id]);
  };
  await person("op_ok", { operator: true, totp: true });
  await person("op_notp", { operator: true, totp: false });
  await person("op_cust", { operator: false, totp: true });
  await person("op_gone", { operator: true, totp: true, deleted: true });
  // a fresh code for someone: the step is cleared first so the same 30 seconds can be used by several checks
  const code = async (id: string) => {
    await q(`UPDATE "User" SET "totpLastStep"=NULL WHERE id=$1`, [id]);
    return totpAt(secrets[id], new Date());
  };
  let n = 0;
  const ip = () => `203.0.113.${++n}`;
  const login = async (id: string, over: { password?: string; code?: string; ip?: string } = {}) =>
    operatorLogin({ email: `${id}@ops.test`, password: over.password ?? PW, code: over.code ?? (await code(id)), ip: over.ip ?? ip() });

  await check("an operator with the right password and code gets in, with their role and company", async () => {
    const r = await login("op_ok");
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) assert.deepEqual([r.user.id, r.user.role, r.user.orgId], ["op_ok", "ADMIN", "o_op"]);
    assert.equal((await q(`SELECT 1 FROM "ActivityLog" WHERE "userId"='op_ok' AND action='MASTER_LOGIN'`)).length, 1);
  });

  await check("every other case gets the same plain refusal: customer, no two-step, deleted, unknown, wrong password, wrong code, no code", async () => {
    const refused = async (r: Awaited<ReturnType<typeof login>>) => assert.deepEqual(r, { ok: false, reason: "invalid" });
    await refused(await login("op_cust"));
    await refused(await login("op_notp"));
    await refused(await login("op_gone"));
    await refused(await operatorLogin({ email: "nobody@ops.test", password: PW, code: "123456", ip: ip() }));
    await refused(await login("op_ok", { password: "wrong-password-1" }));
    await refused(await login("op_ok", { code: "000000" }));
    await refused(await operatorLogin({ email: "op_ok@ops.test", password: PW, code: "", ip: ip() }));
    await refused(await operatorLogin({ email: "not an email", password: PW, code: "1", ip: ip() }));
  });

  await check("a code cannot be used twice", async () => {
    await person("op_reuse", { operator: true, totp: true });
    const c = await code("op_reuse");
    assert.ok((await login("op_reuse", { code: c })).ok);
    assert.deepEqual(await login("op_reuse", { code: c }), { ok: false, reason: "invalid" });
  });

  await check("a sign-in from a new network address tells the operator and the security contact, once per address", async () => {
    await person("op_place", { operator: true, totp: true });
    const before = mails().length;
    const here = "198.51.100.77";
    assert.ok((await login("op_place", { ip: here })).ok);
    const sent = mails().slice(before).filter((m) => /new place/.test(m.subject));
    assert.deepEqual(sent.map((m) => m.to).sort(), ["op_place@ops.test", "security@owner.test"]);
    assert.ok(sent[0].text.includes(here));
    const again = mails().length;
    assert.ok((await login("op_place", { ip: here })).ok);
    assert.equal(mails().length, again, "the same address again: no new mail");
    assert.ok((await login("op_place", { ip: "198.51.100.78" })).ok);
    assert.ok(mails().length > again, "another new address: told again");
  });

  await check("six attempts on one address in 15 minutes, then refused until the window ends (right details do not help)", async () => {
    for (let i = 0; i < 6; i++) await operatorLogin({ email: "op_ok_limit@ops.test", password: "x", code: "1", ip: ip() });
    assert.deepEqual(await operatorLogin({ email: "op_ok_limit@ops.test", password: PW, code: "123456", ip: ip() }), { ok: false, reason: "rate_limited" });
  });

  await check("one network address trying many accounts is stopped too (12 attempts)", async () => {
    const same = "192.0.2.200";
    for (let i = 0; i < 12; i++) await operatorLogin({ email: `spray${i}@ops.test`, password: "x", code: "1", ip: same });
    assert.deepEqual(await operatorLogin({ email: "spray99@ops.test", password: "x", code: "1", ip: same }), { ok: false, reason: "rate_limited" });
    await person("op_spray", { operator: true, totp: true });
    assert.deepEqual(await operatorLogin({ email: "op_spray@ops.test", password: PW, code: await code("op_spray"), ip: same }), { ok: false, reason: "rate_limited" }, "a real operator behind that address waits too");
    assert.ok((await login("op_spray")).ok, "but another address is not affected");
  });

  await check("five failures for a real operator raise one alarm to them and the security contact; none for the sixth", async () => {
    // op_cust is not an operator: its failures only tell the security contact
    const logsBefore = (await q(`SELECT 1 FROM "ActivityLog" WHERE action='MASTER_LOGIN_FAILED'`)).length;
    const before = mails().length;
    for (let i = 0; i < 5; i++) await operatorLogin({ email: "op_gone2@ops.test", password: "x", code: "1", ip: ip() });
    const unknown = mails().slice(before).filter((m) => /Repeated failed/.test(m.subject));
    assert.deepEqual(unknown.map((m) => m.to), ["security@owner.test"], "an address that is not an operator: only the security contact");
    assert.equal((await q(`SELECT 1 FROM "ActivityLog" WHERE action='MASTER_LOGIN_FAILED'`)).length, logsBefore + 1);

    await person("op_fail", { operator: true, totp: true });
    const b2 = mails().length;
    for (let i = 0; i < 5; i++) await login("op_fail", { password: "wrong-password-9" });
    const alarm = mails().slice(b2).filter((m) => /Repeated failed/.test(m.subject));
    assert.deepEqual(alarm.map((m) => m.to).sort(), ["op_fail@ops.test", "security@owner.test"]);
    await login("op_fail", { password: "wrong-password-9" });
    assert.equal(mails().slice(b2).filter((m) => /Repeated failed/.test(m.subject)).length, 2, "the sixth failure does not send again");
  });

  await check("removing the operator flag takes effect at once", async () => {
    await person("op_removed", { operator: true, totp: true });
    assert.ok((await login("op_removed")).ok);
    await q(`UPDATE "User" SET "isPlatformAdmin"=false WHERE id='op_removed'`);
    assert.deepEqual(await login("op_removed"), { ok: false, reason: "invalid" });
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
