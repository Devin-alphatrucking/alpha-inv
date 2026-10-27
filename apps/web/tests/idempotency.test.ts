// Database-backed tests of "safe to send twice": the phone app puts a reference on what it creates, and a repeat gives back the first record.
// Run through `npm run test:isolation`.
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

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, n)]);

async function main() {
  const site = await import("@/lib/flows/site");
  const purchase = await import("@/lib/flows/purchase");
  const delivery = await import("@/lib/flows/delivery");
  const { clientRefOf } = await import("@/lib/idempotency");

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows as T[];
  const count = async (table: string, where = "TRUE") => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`))[0].n);

  await q(`INSERT INTO "Organization"(id,name,slug,status,"updatedAt") VALUES ('o_id_a','Id Co A','o_id_a','ACTIVE',now()),('o_id_b','Id Co B','o_id_b','ACTIVE',now())`);
  const person = async (id: string, orgId: string, role: string) => {
    await q(`INSERT INTO "User"(id,name,email,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,'x',now(),now())`, [id, `${role} ${id}`, `${id}@id.test`]);
    await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ($1,$2,$3,$4::"Role")`, [`m_${id}`, id, orgId, role]);
    return { id, role: role as never, orgId };
  };
  const admin = await person("id_admin", "o_id_a", "ADMIN");
  const eng = await person("id_eng", "o_id_a", "ENGINEER");
  const eng2 = await person("id_eng2", "o_id_a", "ENGINEER");
  const other = await person("id_other", "o_id_b", "ADMIN");
  await q(`INSERT INTO "Project"(id,"organizationId",name,status,"updatedAt") VALUES ('p_id1','o_id_a','Tower A','ACTIVE',now()),('p_idb','o_id_b','Other','ACTIVE',now())`);
  for (const k of ["eng", "eng2"]) await q(`INSERT INTO "ProjectAssignment"(id,"organizationId","userId","projectId") VALUES ($1,'o_id_a',$2,'p_id1')`, [`pa_id_${k}`, `id_${k}`]);
  await q(`INSERT INTO "Vendor"(id,"organizationId",name) VALUES ('v_id','o_id_a','Supplier')`);

  await check("references: none is fine, a good one is kept, a malformed one is refused", () => {
    assert.equal(clientRefOf(undefined), null);
    assert.equal(clientRefOf(""), null);
    assert.equal(clientRefOf("abcd1234-ef56"), "abcd1234-ef56");
    for (const bad of ["short", "has space in it here", "x".repeat(65), 42, "bad/ref/chars!!"]) assert.equal(clientRefOf(bad), false, String(bad));
  });

  await check("an issue sent twice (a lost reply) is made once and the repeat returns the same issue", async () => {
    const data = { title: "Crack in beam B3", severity: "HIGH" };
    const a = await site.createIssue(eng, "p_id1", data, "issue-ref-0001");
    const b = await site.createIssue(eng, "p_id1", data, "issue-ref-0001");
    assert.ok(a.ok && b.ok && a.id === b.id, JSON.stringify([a, b]));
    assert.equal(await count("SiteIssue", `"clientRef"='issue-ref-0001'`), 1);
    // without a reference two identical saves are two issues (as before)
    await site.createIssue(eng, "p_id1", { title: "Same text", severity: "LOW" });
    await site.createIssue(eng, "p_id1", { title: "Same text", severity: "LOW" });
    assert.equal(await count("SiteIssue", `title='Same text'`), 2);
    // a repeat is answered even if the issue has since been moved along
    assert.ok((await site.setIssueStatus(eng, a.ok ? a.id : "", "IN_PROGRESS")).ok);
    assert.ok((await site.createIssue(eng, "p_id1", data, "issue-ref-0001")).ok);
  });

  await check("five copies of the same save arriving at once make one issue", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => site.createIssue(eng, "p_id1", { title: "Raced issue", severity: "LOW" }, "issue-race-0001")));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.equal(new Set(results.map((r) => (r.ok ? r.id : ""))).size, 1);
    assert.equal(await count("SiteIssue", `"clientRef"='issue-race-0001'`), 1);
  });

  await check("a reference belongs to one person: someone else using it is refused, and so is a malformed one", async () => {
    const taken = await site.createIssue(eng2, "p_id1", { title: "Someone else", severity: "LOW" }, "issue-ref-0001");
    assert.ok(!taken.ok && taken.field === "clientRef");
    const bad = await site.createIssue(eng, "p_id1", { title: "Bad reference", severity: "LOW" }, "no good!");
    assert.ok(!bad.ok && bad.field === "clientRef");
    // another company can use the same text without any clash
    const mine = await site.createIssue(other, "p_idb", { title: "Other company", severity: "LOW" }, "issue-ref-0001");
    assert.ok(mine.ok);
  });

  await check("a material request sent twice is made once, keeps its number, and the next request gets the next number", async () => {
    const data = { lines: [{ description: "Cement OPC 53", unit: "bag", quantity: "40" }] };
    const a = await purchase.saveRequest(eng, { projectId: "p_id1", data, clientRef: "req-ref-000001" });
    const b = await purchase.saveRequest(eng, { projectId: "p_id1", data, clientRef: "req-ref-000001" });
    assert.ok(a.ok && b.ok && a.id === b.id && a.number === b.number, JSON.stringify([a, b]));
    assert.equal(await count("MaterialRequest", `"clientRef"='req-ref-000001'`), 1);
    const next = await purchase.saveRequest(eng, { projectId: "p_id1", data, clientRef: "req-ref-000002" });
    assert.ok(next.ok && next.number !== a.number);
    const nums = (await q<{ number: string }>(`SELECT number FROM "MaterialRequest" WHERE "organizationId"='o_id_a' ORDER BY number`)).map((r) => r.number);
    assert.equal(new Set(nums).size, nums.length);
    assert.ok(nums[1].endsWith("-0002") && nums.length === 2, "no number was skipped or burned by the repeat");
    const race = await Promise.all(Array.from({ length: 4 }, () => purchase.saveRequest(eng, { projectId: "p_id1", data, clientRef: "req-race-00001" })));
    assert.ok(race.every((r) => r.ok) && new Set(race.map((r) => (r.ok ? r.id : ""))).size === 1);
    assert.equal(await count("MaterialRequest", `"clientRef"='req-race-00001'`), 1);
  });

  let orderId = "";
  await check("a delivery sent twice is recorded once: the quantities count once and the order status moves once", async () => {
    const order = await purchase.createOrder(admin, { projectId: "p_id1", data: { vendorId: "v_id", lines: [{ description: "Cement", unit: "bag", quantity: "40", rate: "380", gstPercent: "18" }] } });
    assert.ok(order.ok);
    if (!order.ok) return;
    orderId = order.id;
    assert.ok((await purchase.sendOrder(admin, orderId)).ok);
    const line = (await delivery.getDelivery(eng, orderId))!.lines[0].id;
    const body = { challanNo: "CH-1", lines: [{ orderLineId: line, quantity: "30", rejected: "2" }] };
    const a = await delivery.recordReceipt(eng, orderId, body, "rec-ref-000001");
    const b = await delivery.recordReceipt(eng, orderId, body, "rec-ref-000001");
    assert.ok(a.ok && b.ok && a.id === b.id, JSON.stringify([a, b]));
    const view = (await delivery.getDelivery(eng, orderId))!;
    assert.equal(view.receipts.length, 1);
    assert.equal(view.lines[0].received, "30", "30 once, not 60");
    assert.equal(view.progress, "PARTLY");
    const race = await Promise.all(Array.from({ length: 4 }, () => delivery.recordReceipt(eng, orderId, { lines: [{ orderLineId: line, quantity: "5" }] }, "rec-race-00001")));
    assert.ok(race.every((r) => r.ok) && new Set(race.map((r) => (r.ok ? r.id : ""))).size === 1);
    assert.equal((await delivery.getDelivery(eng, orderId))!.lines[0].received, "35");
    // the same reference for a different order or person is not a repeat
    const taken = await delivery.recordReceipt(eng2, orderId, body, "rec-ref-000001");
    assert.ok(!taken.ok && taken.field === "clientRef");
  });

  await check("photos sent twice are stored once each; a batch sent again with more files adds only the new ones", async () => {
    const files = [{ name: "a.jpg", bytes: JPEG(1) }, { name: "b.jpg", bytes: JPEG(2) }];
    const a = await site.addPhotos(eng, { projectId: "p_id1", clientRef: "photo-ref-0001", files });
    const b = await site.addPhotos(eng, { projectId: "p_id1", clientRef: "photo-ref-0001", files });
    assert.ok(a.ok && b.ok && a.added === 2 && b.added === 2, JSON.stringify([a, b]));
    assert.equal(await count("SitePhoto", `"clientRef" LIKE 'photo-ref-0001-%'`), 2);
    const more = await site.addPhotos(eng, { projectId: "p_id1", clientRef: "photo-ref-0001", files: [...files, { name: "c.jpg", bytes: JPEG(3) }] });
    assert.ok(more.ok);
    assert.equal(await count("SitePhoto", `"clientRef" LIKE 'photo-ref-0001-%'`), 3);
    const race = await Promise.all(Array.from({ length: 3 }, () => site.addPhotos(eng, { projectId: "p_id1", clientRef: "photo-race-0001", files: [{ name: "r.jpg", bytes: JPEG(9) }] })));
    assert.ok(race.every((r) => r.ok));
    assert.equal(await count("SitePhoto", `"clientRef" LIKE 'photo-race-0001-%'`), 1);
    const taken = await site.addPhotos(eng2, { projectId: "p_id1", clientRef: "photo-ref-0001", files });
    assert.ok(!taken.ok && taken.field === "clientRef");
    assert.equal((await site.addPhotos(eng, { projectId: "p_id1", clientRef: "bad ref!", files })).ok, false);
  });

  await check("the same reference is only unique inside one company", async () => {
    assert.equal(await count("SiteIssue", `"clientRef"='issue-ref-0001'`), 2, "one in each company");
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
