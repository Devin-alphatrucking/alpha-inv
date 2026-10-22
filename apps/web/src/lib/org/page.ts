import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { dbFor } from "@/lib/org/scoped-db";

/**
 * For server pages/layouts: the signed-in session, the user's company, and a
 * database handle locked to that company. Redirects to /login when there is no
 * session or no usable company.
 */
export async function pageOrg() {
  const session = await auth();
  if (!session?.user?.id || !session.user.orgId) redirect("/login");
  const orgId = session.user.orgId;
  return {
    session,
    orgId,
    db: dbFor(orgId),
    /** `{ id, role, orgId }`: what the access helpers (projectAccessWhere, ...) take. */
    user: { id: session.user.id, role: session.user.role, orgId },
  };
}
