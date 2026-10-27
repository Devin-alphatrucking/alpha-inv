import { AsyncLocalStorage } from "node:async_hooks";
import { db as rawDb } from "@alpha/db";

/**
 * Company-scoped database handle (step 2c of docs/PHASE-2-COMPANIES.md).
 *
 * `dbFor(orgId)` returns a client where every query on a company-owned table
 * is forced to that company:
 *  - reads / updates / deletes get `organizationId = orgId` added to `where`
 *    (overriding anything the caller passed);
 *  - creates are stamped with `organizationId = orgId`;
 *  - changing `organizationId` on an existing row is refused.
 *
 * Limits (so nobody assumes more than this gives):
 *  - NESTED writes (e.g. `lineItems: { create: [...] }`) are not stamped here;
 *    set `organizationId` on nested rows explicitly.
 *  - Raw SQL ($queryRaw / $executeRaw) is not touched.
 *
 * Second, independent layer (step 2d): PostgreSQL Row-Level Security. Every
 * query below runs together with `set_config('app.org_id', <company>, true)`
 * in the SAME database transaction, and the table policies only allow rows of
 * that company. This protects against mistakes in the code above, but ONLY when
 * the app connects as an ordinary role (not the table owner / superuser).
 *
 * Interactive transactions must use `db.$transaction(async (tx) => ...)` on this
 * client and use `tx` inside. The company is set once at the start of the
 * transaction. Do not mix in another client inside the callback.
 */

/** True while inside a scoped interactive transaction (company already set). */
const inScopedTransaction = new AsyncLocalStorage<boolean>();

export const COMPANY_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "Project",
  "Category",
  "Material",
  "Vendor",
  "Invoice",
  "InvoiceLineItem",
  "InvoiceComment",
  "SiteReport",
  "SitePhoto",
  "SiteIssue",
  "ProjectDocument",
  "DocumentRevision",
  "DocumentCounter",
  "MaterialRequest",
  "MaterialRequestLine",
  "PurchaseOrder",
  "PurchaseOrderLine",
  "GoodsReceipt",
  "GoodsReceiptLine",
  "Payment",
  "ProjectNote",
  "ProjectAssignment",
  "AuditLog",
  "ActivityLog",
  "ApiErrorLog",
  "PageUsageEvent",
  "SupportTicket",
]);

const WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type AnyArgs = Record<string, unknown> | undefined;

function stamp<T extends Record<string, unknown>>(row: T, orgId: string): T {
  return { ...row, organizationId: orgId };
}

function refuseOrgChange(data: unknown) {
  if (data && typeof data === "object" && "organizationId" in (data as object)) {
    throw new Error("Changing a record's company is not allowed.");
  }
}

/** Pure argument rewrite, exported so it can be unit-tested without a database. */
export function scopeArgs(
  model: string | undefined,
  operation: string,
  args: AnyArgs,
  orgId: string
): AnyArgs {
  if (!orgId) throw new Error("A company id is required for scoped queries.");
  if (!model || !COMPANY_SCOPED_MODELS.has(model)) return args;

  const next: Record<string, unknown> = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
      refuseOrgChange(next.data);
    }
    next.where = { ...((next.where as object | undefined) ?? {}), organizationId: orgId };
    return next;
  }

  switch (operation) {
    case "create":
      next.data = stamp((next.data as Record<string, unknown>) ?? {}, orgId);
      return next;
    case "createMany":
    case "createManyAndReturn": {
      const data = next.data;
      next.data = Array.isArray(data)
        ? data.map((row) => stamp(row as Record<string, unknown>, orgId))
        : stamp((data as Record<string, unknown>) ?? {}, orgId);
      return next;
    }
    case "upsert":
      refuseOrgChange(next.update);
      next.where = { ...((next.where as object | undefined) ?? {}), organizationId: orgId };
      next.create = stamp((next.create as Record<string, unknown>) ?? {}, orgId);
      return next;
    default:
      return next;
  }
}

const SET_COMPANY = (orgId: string) =>
  rawDb.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;

const cache = new Map<string, ReturnType<typeof build>>();

function build(orgId: string) {
  const extended = rawDb.$extends({
    name: "company-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const next = scopeArgs(model, operation, args as AnyArgs, orgId) as typeof args;
          // Inside a scoped transaction the company was set when it started.
          if (inScopedTransaction.getStore()) return query(next);
          // Otherwise set it and run the query in one transaction (same connection).
          const [, result] = await rawDb.$transaction([SET_COMPANY(orgId), query(next)]);
          return result;
        },
      },
    },
  });

  // Route interactive transactions through "set the company first".
  return new Proxy(extended, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "$transaction") {
        return (arg: unknown, options?: unknown) => {
          if (typeof arg !== "function") {
            throw new Error(
              "Batch $transaction([...]) is not supported on a company-scoped client. Use the callback form."
            );
          }
          return (target as typeof extended).$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
              return inScopedTransaction.run(true, () => (arg as (tx: unknown) => unknown)(tx));
            },
            options as never
          );
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof extended;
}

/** Database handle locked to one company. Cheap to call per request. */
export function dbFor(orgId: string) {
  if (!orgId) throw new Error("A company id is required for scoped queries.");
  let client = cache.get(orgId);
  if (!client) {
    if (cache.size > 500) cache.clear();
    client = build(orgId);
    cache.set(orgId, client);
  }
  return client;
}

export type ScopedDb = ReturnType<typeof dbFor>;
