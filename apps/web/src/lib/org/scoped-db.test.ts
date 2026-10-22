// Run with: npx tsx apps/web/src/lib/org/scoped-db.test.ts
// Pure tests of the query rewriting; a database-backed isolation suite comes in step 2d.
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@localhost:5432/ci";

async function main() {
  const { scopeArgs } = await import("./scoped-db");
  const A = "org_a";

  // reads get the company filter, overriding a caller-supplied one
  assert.deepEqual(scopeArgs("Invoice", "findMany", { where: { status: "PAID" } }, A), {
    where: { status: "PAID", organizationId: A },
  });
  assert.deepEqual(scopeArgs("Invoice", "findMany", undefined, A), { where: { organizationId: A } });
  assert.deepEqual(
    scopeArgs("Invoice", "findMany", { where: { organizationId: "org_b" } }, A),
    { where: { organizationId: A } },
    "a caller cannot ask for another company"
  );

  // by-id lookups are filtered too
  assert.deepEqual(scopeArgs("Project", "findUnique", { where: { id: "p1" } }, A), {
    where: { id: "p1", organizationId: A },
  });
  for (const op of ["update", "delete", "updateMany", "deleteMany", "count", "aggregate", "groupBy", "findFirst"]) {
    const out = scopeArgs("Vendor", op, { where: { id: "v1" }, data: { name: "x" } }, A) as { where: object };
    assert.deepEqual(out.where, { id: "v1", organizationId: A }, op);
  }

  // creates are stamped
  assert.deepEqual(scopeArgs("Category", "create", { data: { name: "Steel" } }, A), {
    data: { name: "Steel", organizationId: A },
  });
  assert.deepEqual(
    scopeArgs("InvoiceLineItem", "createMany", { data: [{ description: "a" }, { description: "b" }] }, A),
    { data: [{ description: "a", organizationId: A }, { description: "b", organizationId: A }] }
  );
  const up = scopeArgs("Vendor", "upsert", { where: { id: "v" }, create: { name: "n" }, update: { name: "m" } }, A) as {
    where: object; create: object; update: object;
  };
  assert.deepEqual(up.where, { id: "v", organizationId: A });
  assert.deepEqual(up.create, { name: "n", organizationId: A });
  assert.deepEqual(up.update, { name: "m" });

  // moving a row to another company is refused
  assert.throws(() => scopeArgs("Invoice", "update", { where: { id: "i" }, data: { organizationId: "org_b" } }, A));
  assert.throws(() => scopeArgs("Vendor", "upsert", { where: { id: "v" }, create: {}, update: { organizationId: "x" } }, A));

  // tables that are not company-owned are left alone
  assert.deepEqual(scopeArgs("User", "findMany", { where: { email: "x" } }, A), { where: { email: "x" } });
  assert.deepEqual(scopeArgs("Membership", "create", { data: { userId: "u" } }, A), { data: { userId: "u" } });

  // no company means no query
  assert.throws(() => scopeArgs("Invoice", "findMany", {}, ""));

  // the extended client builds and exposes the model API
  const { dbFor } = await import("./scoped-db");
  const scopedClient = dbFor("org_a");
  assert.equal(typeof scopedClient.invoice.findMany, "function");
  assert.equal(typeof scopedClient.$transaction, "function");
  assert.throws(() => dbFor(""));

  console.log("scoped-db: all checks passed");
  process.exit(0);
}
main();
