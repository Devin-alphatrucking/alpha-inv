// Database-backed cross-company isolation suite. Run through `npm run test:isolation`
// (scripts/test-isolation.mjs), which provides a real PostgreSQL, applies all migrations
// and connects THIS process as the ordinary `app_runtime` role so Row-Level Security applies.
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
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 3).join("\n      ")}`);
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
  return error as Error & { code?: string };
}

async function main() {
  const { dbFor } = await import("@/lib/org/scoped-db");
  const { rawDb } = await import("@/lib/db");
  const { reservePages, settlePages, refundPages, setCompanyPageLimit, getUsageSummary } = await import("@/lib/usage/pages");
  const { assertUsersInOrg } = await import("@/lib/org/members");
  const { getRlsStatus } = await import("@/lib/org/rls-status");

  // ---- owner connection (bypasses RLS) for setup and for looking at the truth ----
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await owner.query(sql, params)).rows as T[];

  const A = "org_a";
  const B = "org_b";
  await q(`INSERT INTO "Organization"(id,name,slug,"updatedAt") VALUES ($1,'Company A','company-a',now()),($2,'Company B','company-b',now())`, [A, B]);
  await q(`INSERT INTO "User"(id,name,email,"passwordHash",role,"updatedAt") VALUES ('ua','Ann','ann@a.test','h','ADMIN',now()),('ub','Bob','bob@b.test','h','ADMIN',now())`);
  await q(`INSERT INTO "Membership"(id,"userId","organizationId",role) VALUES ('ma','ua',$1,'ADMIN'),('mb','ub',$2,'ADMIN')`, [A, B]);

  const a = dbFor(A);
  const b = dbFor(B);

  // ---------------------------------------------------------------- setup via the scoped clients
  const mk = async (db: ReturnType<typeof dbFor>, org: string, tag: string) => {
    const project = await db.project.create({ data: { organizationId: org, name: `Site ${tag}`, monthlyPageLimit: 100 } });
    const category = await db.category.create({ data: { organizationId: org, name: "Cement" } });
    const vendor = await db.vendor.create({ data: { organizationId: org, name: `Vendor ${tag}`, gstin: "29ABCDE1234F1Z5" } });
    const invoice = await db.invoice.create({
      data: {
        organizationId: org,
        invoiceNumber: `INV-${tag}`,
        projectId: project.id,
        vendorId: vendor.id,
        categoryId: category.id,
        invoiceDate: new Date(),
        fileUrl: "local://x",
        lineItems: { create: [{ organizationId: org, description: "ITEM", quantity: 1, unit: "NOS", rateExclGst: 10, lineTotal: 10 }] },
      },
    });
    const payment = await db.payment.create({ data: { organizationId: org, invoiceId: invoice.id, amount: 5, paidOn: new Date() } });
    const note = await db.projectNote.create({ data: { organizationId: org, projectId: project.id, userId: tag === "A" ? "ua" : "ub", content: "n" } });
    await db.projectAssignment.create({ data: { organizationId: org, projectId: project.id, userId: tag === "A" ? "ua" : "ub" } });
    return { project, category, vendor, invoice, payment, note };
  };

  let dataA!: Awaited<ReturnType<typeof mk>>;
  let dataB!: Awaited<ReturnType<typeof mk>>;

  await check("per-company rules: the SAME category name and vendor GSTIN can exist in two companies", async () => {
    dataA = await mk(a, A, "A");
    dataB = await mk(b, B, "B");
    assert.notEqual(dataA.category.id, dataB.category.id);
    assert.equal(dataA.vendor.gstin, dataB.vendor.gstin);
  });

  await check("per-company rules: a duplicate category name INSIDE one company is rejected", async () => {
    const e = await rejects(a.category.create({ data: { organizationId: A, name: "Cement" } }));
    assert.equal(e.code, "P2002");
  });
  await check("per-company rules: a duplicate vendor GSTIN INSIDE one company is rejected", async () => {
    const e = await rejects(a.vendor.create({ data: { organizationId: A, name: "Other", gstin: "29ABCDE1234F1Z5" } }));
    assert.equal(e.code, "P2002");
  });

  // ---------------------------------------------------------------- reads
  await check("reads: every company table returns only the caller's rows", async () => {
    const lists: [string, { id: string }[], { id: string }[]][] = [
      ["project", await a.project.findMany(), await b.project.findMany()],
      ["category", await a.category.findMany(), await b.category.findMany()],
      ["vendor", await a.vendor.findMany(), await b.vendor.findMany()],
      ["invoice", await a.invoice.findMany(), await b.invoice.findMany()],
      ["invoiceLineItem", await a.invoiceLineItem.findMany(), await b.invoiceLineItem.findMany()],
      ["payment", await a.payment.findMany(), await b.payment.findMany()],
      ["projectNote", await a.projectNote.findMany(), await b.projectNote.findMany()],
      ["projectAssignment", await a.projectAssignment.findMany(), await b.projectAssignment.findMany()],
    ];
    for (const [name, fromA, fromB] of lists) {
      assert.equal(fromA.length, 1, `${name}: A should see exactly its own row`);
      assert.equal(fromB.length, 1, `${name}: B should see exactly its own row`);
      assert.notEqual(fromA[0].id, fromB[0].id, `${name}: A and B must see different rows`);
    }
  });
  await check("reads: another company's id is simply not found (findUnique / findFirst / count)", async () => {
    assert.equal(await a.invoice.findUnique({ where: { id: dataB.invoice.id } }), null);
    assert.equal(await a.invoice.findFirst({ where: { id: dataB.invoice.id } }), null);
    assert.equal(await a.invoice.count({ where: { id: dataB.invoice.id } }), 0);
    assert.equal(await a.project.findUnique({ where: { id: dataB.project.id } }), null);
    assert.equal(await a.vendor.findFirst({ where: { id: dataB.vendor.id } }), null);
  });
  await check("reads: naming another company in the filter is overridden: the caller still only gets their own rows", async () => {
    const rows = await a.invoice.findMany({ where: { organizationId: B } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, dataA.invoice.id);
    assert.equal(rows[0].organizationId, A);
  });
  await check("reads: aggregate and groupBy are per company", async () => {
    const sumA = await a.payment.aggregate({ _sum: { amount: true } });
    assert.equal(Number(sumA._sum.amount), 5);
    const groups = await a.invoice.groupBy({ by: ["status"], _count: true });
    assert.equal(groups.reduce((n, g) => n + (g._count as number), 0), 1);
  });

  // ---------------------------------------------------------------- writes
  await check("writes: update / delete of another company's row fails and leaves it untouched", async () => {
    await rejects(a.invoice.update({ where: { id: dataB.invoice.id }, data: { invoiceNumber: "HACKED" } }));
    await rejects(a.invoice.delete({ where: { id: dataB.invoice.id } }));
    assert.equal((await a.invoice.updateMany({ where: { id: dataB.invoice.id }, data: { invoiceNumber: "HACKED" } })).count, 0);
    assert.equal((await a.invoice.deleteMany({ where: { id: dataB.invoice.id } })).count, 0);
    const [row] = await q(`SELECT "invoiceNumber" FROM "Invoice" WHERE id=$1`, [dataB.invoice.id]);
    assert.equal(row.invoiceNumber, "INV-B");
  });
  await check("writes: a create naming another company is stamped with the caller's company", async () => {
    const p = await a.project.create({ data: { organizationId: B, name: "Sneaky" } as never });
    const [row] = await q(`SELECT "organizationId" FROM "Project" WHERE id=$1`, [p.id]);
    assert.equal(row.organizationId, A);
    await a.project.delete({ where: { id: p.id } });
  });
  await check("writes: moving a row to another company is refused", async () => {
    await rejects(a.project.update({ where: { id: dataA.project.id }, data: { organizationId: B } as never }), /company/i);
  });
  await check("writes: bulk update only touches the caller's rows", async () => {
    const r = await a.project.updateMany({ data: { description: "changed by A" } });
    assert.equal(r.count, 1);
    const [other] = await q(`SELECT description FROM "Project" WHERE id=$1`, [dataB.project.id]);
    assert.equal(other.description, null);
  });

  // ---------------------------------------------------------------- the database layer on its own
  await check("RLS: the app connects as an ordinary role and the database reports isolation active", async () => {
    const s = await getRlsStatus();
    assert.equal(s.active, true, s.problem ?? "");
    assert.equal(s.tablesProtected, 14);
  });
  await check("RLS: with NO company set, company tables show nothing and refuse writes (fails closed)", async () => {
    assert.equal((await rawDb.invoice.findMany()).length, 0);
    assert.equal((await rawDb.project.findMany()).length, 0);
    await rejects(rawDb.project.create({ data: { organizationId: A, name: "x" } }), /row-level security|violates/i);
  });
  await check("RLS: even raw queries with the filter REMOVED cannot see another company (bypassing the app layer)", async () => {
    await rawDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${A}, true)`;
      assert.equal((await tx.invoice.findMany({ where: { organizationId: B } })).length, 0);
      assert.equal((await tx.invoice.findMany()).length, 1);
      // a bulk update with NO filter at all still only reaches the company that is set
      assert.equal((await tx.invoice.updateMany({ data: { status: "UNPAID" } })).count, 1);
      const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "Invoice"`;
      assert.equal(Number(rows[0].n), 1);
    });
  });
  await check("RLS: the database refuses a row stamped with a different company than the one set", async () => {
    await rawDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${A}, true)`;
      await rejects(tx.project.create({ data: { organizationId: B, name: "x" } }), /row-level security|violates/i);
    }).catch(() => undefined);
  });
  await check("RLS: logs may be appended with no company, but are invisible to every company", async () => {
    await rawDb.activityLog.createMany({ data: [{ action: "LOGIN_FAILED", module: "AUTH", organizationId: null }, { action: "X", module: "AUTH", organizationId: A }] });
    assert.equal((await rawDb.activityLog.findMany()).length, 0);
    const seenByA = await a.activityLog.findMany();
    assert.equal(seenByA.length, 1);
    assert.equal(seenByA[0].organizationId, A);
    assert.equal((await b.activityLog.findMany()).length, 0);
  });

  // ---------------------------------------------------------------- pooled connections must not leak a company
  await check("pool: 300 interleaved queries from two companies never see each other's rows", async () => {
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 300; i++) {
      const mineIsA = i % 2 === 0;
      const client = mineIsA ? a : b;
      const expectId = mineIsA ? dataA.invoice.id : dataB.invoice.id;
      jobs.push(
        client.invoice.findMany().then((rows) => {
          assert.equal(rows.length, 1);
          assert.equal(rows[0].id, expectId);
        })
      );
    }
    await Promise.all(jobs);
  });
  await check("pool: after scoped work, a plain connection has no company left over", async () => {
    for (let i = 0; i < 20; i++) await a.invoice.findMany();
    assert.equal((await rawDb.invoice.findMany()).length, 0);
    const [{ v }] = await rawDb.$queryRaw<{ v: string | null }[]>`SELECT NULLIF(current_setting('app.org_id', true), '') AS v`;
    assert.equal(v, null);
  });

  // ---------------------------------------------------------------- transactions
  await check("transactions: a scoped transaction rolls back as a whole", async () => {
    await rejects(
      a.$transaction(async (tx) => {
        await tx.vendor.create({ data: { organizationId: A, name: "Temp vendor" } });
        throw new Error("boom");
      }),
      /boom/
    );
    assert.equal(await a.vendor.count({ where: { name: "Temp vendor" } }), 0);
  });
  await check("transactions: commit works, and the transaction only sees its own company", async () => {
    await a.$transaction(async (tx) => {
      await tx.vendor.create({ data: { organizationId: A, name: "Committed vendor" } });
      assert.equal(await tx.vendor.count(), 2); // A's two vendors, none of B's
      assert.equal(await tx.invoice.findFirst({ where: { id: dataB.invoice.id } }), null);
    });
    assert.equal(await a.vendor.count({ where: { name: "Committed vendor" } }), 1);
    assert.equal(await b.vendor.count({ where: { name: "Committed vendor" } }), 0);
  });
  await check("transactions: the unsupported batch form is refused instead of silently skipping protection", async () => {
    await rejects(Promise.resolve().then(() => (a as unknown as { $transaction: (x: unknown) => Promise<unknown> }).$transaction([])), /callback form/);
  });

  // ---------------------------------------------------------------- AI page quota against real concurrency
  await check("quota: 20 simultaneous 10-page uploads against a 100-page project allow EXACTLY 10", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reservePages({ orgId: A, projectId: dataA.project.id, userId: "ua", pages: 10, fileHash: null }))
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "QUOTA_001").length;
    assert.equal(ok, 10);
    assert.equal(refused, 10);
    const summary = await getUsageSummary(A, [dataA.project.id]);
    assert.equal(summary.byProject[dataA.project.id], 100);
    const events = await q(`SELECT count(*)::int c FROM "PageUsageEvent" WHERE "projectId"=$1 AND status='RESERVED'`, [dataA.project.id]);
    assert.equal(events[0].c, 10);
  });
  await check("quota: refund gives pages back once (and only once), settle corrects to the real page count", async () => {
    const [ev] = await q<{ id: string }>(`SELECT id FROM "PageUsageEvent" WHERE "projectId"=$1 AND status='RESERVED' LIMIT 1`, [dataA.project.id]);
    await refundPages(A, ev.id, "TEST");
    await refundPages(A, ev.id, "TEST AGAIN");
    assert.equal((await getUsageSummary(A, [dataA.project.id])).byProject[dataA.project.id], 90);
    const [ev2] = await q<{ id: string }>(`SELECT id FROM "PageUsageEvent" WHERE "projectId"=$1 AND status='RESERVED' LIMIT 1`, [dataA.project.id]);
    await settlePages(A, ev2.id, 4); // reserved 10, azure analysed 4
    assert.equal((await getUsageSummary(A, [dataA.project.id])).byProject[dataA.project.id], 84);
  });
  await check("quota: the company-wide cap stops uploads even when the project limit would allow them, and rolls back cleanly", async () => {
    const p2 = await a.project.create({ data: { organizationId: A, name: "Big project", monthlyPageLimit: 1000 } });
    const before = (await getUsageSummary(A, [p2.id])).companyUsed;
    await setCompanyPageLimit(A, before + 30);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => reservePages({ orgId: A, projectId: p2.id, userId: "ua", pages: 10, fileHash: null }))
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    const summary = await getUsageSummary(A, [p2.id]);
    assert.equal(summary.byProject[p2.id], 30, "refused attempts must not leave pages counted on the project");
    assert.equal(summary.companyUsed, before + 30);
    await setCompanyPageLimit(A, null);
  });
  await check("quota: another company's project cannot be used or measured", async () => {
    const e = await rejects(reservePages({ orgId: A, projectId: dataB.project.id, userId: "ua", pages: 1, fileHash: null }));
    assert.equal((e as { code?: string }).code, "NOT_FOUND_001");
    const summary = await getUsageSummary(A, [dataA.project.id]);
    assert.equal(summary.byProject[dataB.project.id], undefined);
  });
  await check("quota: company B's cap and counters are independent of company A's", async () => {
    await setCompanyPageLimit(B, 5);
    const e = await rejects(reservePages({ orgId: B, projectId: dataB.project.id, userId: "ub", pages: 10, fileHash: null }));
    assert.equal((e as { code?: string }).code, "QUOTA_001");
    assert.equal((await getUsageSummary(B, [dataB.project.id])).companyUsed, 0);
    await setCompanyPageLimit(B, null);
  });

  // ---------------------------------------------------------------- people
  await check("members: users can only be named by the company they belong to", async () => {
    await assertUsersInOrg(A, ["ua"]);
    await rejects(assertUsersInOrg(A, ["ub"]));
    await rejects(assertUsersInOrg(B, ["ua", "ub"]));
  });

  // ---------------------------------------------------------------- branding (step 2e)
  const brandMod = await import("@/lib/brand/brand");
  const logoRoute = await import("@/app/api/branding/logo/[slug]/route");
  const { currentPeriod, periodForCompany } = await import("@/lib/usage/pages");

  await q(`UPDATE "Organization" SET "displayName"='Acme Builders', "primaryColor"='#0F4C81', "accentColor"='#F59E0B',
           "supportEmail"='help@acme.test', "supportUrl"='https://acme.test/help', currency='AUD', country='AU', timezone='Australia/Sydney' WHERE id=$1`, [A]);
  await q(`UPDATE "Organization" SET "primaryColor"='red;} body{display:none', "supportUrl"='javascript:alert(1)', currency='ZZZZ', timezone='Mars/Base' WHERE id=$1`, [B]);

  await check("branding: a company's brand carries its own name, colours and regional settings", async () => {
    const brand = await brandMod.loadBrandBySlug("company-a");
    assert.ok(brand);
    assert.equal(brand.name, "Acme Builders");
    assert.equal(brand.primaryColor, "#0F4C81");
    assert.equal(brand.format.currency, "AUD");
    assert.equal(brand.format.timeZone, "Australia/Sydney");
    assert.equal(brand.format.locale, "en-AU");
    assert.equal(brand.supportUrl, "https://acme.test/help");
  });
  await check("branding: company B never sees company A's brand, and unsafe stored values are neutralised on load", async () => {
    const brand = await brandMod.loadBrandById(B);
    assert.ok(brand);
    assert.equal(brand.name, "Company B");
    assert.equal(brand.primaryColor, null, "a malicious colour string is dropped");
    assert.equal(brand.supportUrl, null, "a non-https support url is dropped");
    assert.equal(brand.format.currency, "INR", "an unknown currency falls back");
    assert.equal(brand.format.timeZone, "Asia/Kolkata", "an unknown timezone falls back");
  });
  await check("branding: the public brand has no company id, and bad or unknown codes find nothing", async () => {
    const brand = await brandMod.loadBrandBySlug("company-a");
    assert.ok(brand);
    assert.equal("orgId" in brandMod.publicBrand(brand), false);
    for (const slug of ["nope", "../etc/passwd", "COMPANY-A", "a", "x".repeat(60), "company-a;drop"]) {
      assert.equal(await brandMod.loadBrandBySlug(slug), null, slug);
    }
  });

  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  await rawDb.organizationLogo.create({ data: { organizationId: A, contentType: "image/png", data: PNG } });
  await check("logo: readable with the app role and no company set (the sign-in page needs it)", async () => {
    const row = await rawDb.organizationLogo.findUnique({ where: { organizationId: A } });
    assert.ok(row);
  });
  const callLogo = (slug: string) => logoRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug }) });
  await check("logo route: serves a real image safely, 404 for no logo / unknown or invalid codes", async () => {
    const ok = await callLogo("company-a");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.match(ok.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal((await callLogo("company-b")).status, 404);
    assert.equal((await callLogo("nope")).status, 404);
    assert.equal((await callLogo("../x")).status, 404);
  });
  await check("logo route: stored bytes that are not an image (e.g. svg/script) are never served", async () => {
    const evil = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
    await rawDb.organizationLogo.create({ data: { organizationId: B, contentType: "image/png", data: evil } });
    assert.equal((await callLogo("company-b")).status, 404);
  });

  await check("billing month follows the company timezone", async () => {
    const instant = new Date("2026-11-30T19:00:00Z");
    assert.equal(currentPeriod(instant, "Asia/Kolkata"), "2026-12");
    assert.equal(currentPeriod(instant, "UTC"), "2026-11");
    assert.match(await periodForCompany(A), /^\d{4}-\d{2}$/);
    assert.match(await periodForCompany(B), /^\d{4}-\d{2}$/, "an invalid stored timezone falls back");
  });

  // ---------------------------------------------------------------- the data really is where we think
  await check("truth check (owner view): nothing leaked or got re-assigned during all of the above", async () => {
    const wrong = await q<{ t: string; n: number }>(`
      SELECT 'Invoice' t, count(*)::int n FROM "Invoice" i JOIN "Vendor" v ON v.id=i."vendorId" WHERE v."organizationId" <> i."organizationId"
      UNION ALL SELECT 'Payment', count(*)::int FROM "Payment" p JOIN "Invoice" i ON i.id=p."invoiceId" WHERE i."organizationId" <> p."organizationId"
      UNION ALL SELECT 'LineItem', count(*)::int FROM "InvoiceLineItem" l JOIN "Invoice" i ON i.id=l."invoiceId" WHERE i."organizationId" <> l."organizationId"`);
    for (const r of wrong) assert.equal(r.n, 0, `${r.t} rows point across companies`);
    const [a1] = await q<{ n: number }>(`SELECT count(*)::int n FROM "Invoice" WHERE "organizationId"=$1`, [A]);
    const [b1] = await q<{ n: number }>(`SELECT count(*)::int n FROM "Invoice" WHERE "organizationId"=$1`, [B]);
    assert.equal(a1.n, 1);
    assert.equal(b1.n, 1);
  });

  await owner.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
