import { headers } from "next/headers";
import { authenticateBearer } from "@/lib/mobile/sessions";
import { bearerFrom } from "@/lib/mobile/token";
import { assertNotLocked } from "@/lib/plans/lock";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { hasPermission, type Permission, type RoleName } from "@/lib/roles";

export { hasPermission, type Permission } from "@/lib/roles";

async function bearerFromRequest(): Promise<string | null> {
  try {
    return bearerFrom((await headers()).get("authorization"));
  } catch {
    return null; // not inside a request (scripts, tests)
  }
}

export type SessionUser = {
  id: string;
  role: RoleName;
  /** Company the user is working in. Always present for a valid session. */
  orgId: string;
  /** Role inside that company (same as `role` until step 2c/2d). */
  orgRole: RoleName;
  name?: string | null;
  email?: string | null;
};

/**
 * Returns the authenticated session or throws AUTH_001 (401). Never trusts a
 * role/amount/id/company coming from the client — all of them are read from
 * the signed session. A session without a company is treated as signed out.
 */
export async function requireUser(opts: { allowLocked?: boolean } = {}): Promise<SessionUser> {
  const user = await resolveUser();
  // After the free trial (or when a plan ended or stayed unpaid) company data is locked. Only a few things stay open: pass allowLocked for those.
  if (!opts.allowLocked) await assertNotLocked(user.orgId);
  return user;
}

async function resolveUser(): Promise<SessionUser> {
  // The mobile apps send "Authorization: Bearer <token>" instead of a cookie. A browser never adds that header on its own
  // to a cross-site request, so accepting it here does not open the cookie flow to forged requests.
  const bearer = await bearerFromRequest();
  if (bearer) {
    const m = await authenticateBearer(bearer);
    if (!m) throw new AppError("AUTH_001");
    return { id: m.id, role: m.role, orgId: m.orgId, orgRole: m.orgRole, name: m.name, email: m.email };
  }
  const session = await auth();
  if (!session?.user?.id || !session.user.orgId) {
    throw new AppError("AUTH_001");
  }
  return {
    id: session.user.id,
    role: session.user.role,
    orgId: session.user.orgId,
    orgRole: session.user.orgRole ?? session.user.role,
    name: session.user.name,
    email: session.user.email,
  };
}

/**
 * Same as requireUser(); named for business-data code. From step 2c on, every
 * query for company data must filter by the returned `orgId`.
 */
export const requireOrg = requireUser;

/** Requires an authenticated user who holds the given permission (403 if not). */
export async function requirePermission(
  permission: Permission
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) {
    throw new AppError("PERMISSION_001");
  }
  return user;
}

export async function requireAdmin(opts: { allowLocked?: boolean } = {}): Promise<SessionUser> {
  const user = await requireUser(opts);
  if (user.role !== "ADMIN") {
    throw new AppError("PERMISSION_001");
  }
  return user;
}
