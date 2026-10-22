import { rawDb } from "@/lib/db";

export type RlsStatus = {
  /** True only when the database will really enforce company isolation for this connection. */
  active: boolean;
  role: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  ownsTables: boolean;
  tablesProtected: number;
  tablesExpected: number;
  problem: string | null;
};

const EXPECTED = 14; // company tables protected by Row-Level Security

/**
 * Is Row-Level Security actually protecting this connection? Policies exist
 * from the 2d migration, but Postgres skips them for superusers, roles with
 * BYPASSRLS and the table owner. If the app connects as one of those, the
 * database layer is NOT protecting anything (the code-level scoping still is).
 */
export async function getRlsStatus(): Promise<RlsStatus> {
  const rows = await rawDb.$queryRaw<
    { role: string; isSuperuser: boolean; bypassRls: boolean; owns: number; protectedTables: number }[]
  >`
    SELECT current_user::text AS "role",
           r.rolsuper AS "isSuperuser",
           r.rolbypassrls AS "bypassRls",
           (SELECT count(*)::int FROM pg_class c
              JOIN pg_roles o ON o.oid = c.relowner
             WHERE c.relname = 'Invoice' AND c.relkind = 'r' AND o.rolname = current_user) AS "owns",
           (SELECT count(*)::int FROM pg_class c
             WHERE c.relkind = 'r' AND c.relrowsecurity
               AND c.relname IN ('Project','Category','Material','Vendor','Invoice','InvoiceLineItem',
                                 'Payment','ProjectNote','ProjectAssignment','AuditLog','PageUsageEvent',
                                 'ActivityLog','ApiErrorLog','SupportTicket')) AS "protectedTables"
      FROM pg_roles r WHERE r.rolname = current_user`;
  const row = rows[0];
  const ownsTables = (row?.owns ?? 0) > 0;
  const tablesProtected = row?.protectedTables ?? 0;
  let problem: string | null = null;
  if (tablesProtected < EXPECTED) problem = "Row-Level Security is not enabled on all company tables. Apply the latest migration.";
  else if (row?.isSuperuser) problem = "The app connects as a superuser, which skips Row-Level Security.";
  else if (row?.bypassRls) problem = "The app role has BYPASSRLS, which skips Row-Level Security.";
  else if (ownsTables) problem = "The app connects as the table owner, which skips Row-Level Security. Use a separate app role (see packages/db/prisma/rls-setup/app-role.sql).";
  return {
    active: problem === null,
    role: row?.role ?? "unknown",
    isSuperuser: Boolean(row?.isSuperuser),
    bypassesRls: Boolean(row?.bypassRls),
    ownsTables,
    tablesProtected,
    tablesExpected: EXPECTED,
    problem,
  };
}
