import { requireOrg, type SessionUser } from "@/lib/permissions";
import { dbFor, type ScopedDb } from "@/lib/org/scoped-db";

/** Signed-in user plus a database handle locked to their company. */
export async function requireOrgDb(): Promise<{ user: SessionUser; db: ScopedDb }> {
  const user = await requireOrg();
  return { user, db: dbFor(user.orgId) };
}

/** Scoped handle for a user you already have (e.g. from requirePermission()). */
export function scoped(user: Pick<SessionUser, "orgId">): ScopedDb {
  return dbFor(user.orgId);
}
