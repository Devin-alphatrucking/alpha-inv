import { rawDb } from "@/lib/db";
import { pickDefaultMembership } from "@/lib/org/default-membership";

/** Default company + role for a user, or null if no company may be entered. */
export async function loadDefaultMembership(userId: string) {
  const memberships = await rawDb.membership.findMany({
    where: { userId },
    select: { organizationId: true, role: true, createdAt: true, organization: { select: { status: true } } },
  });
  return pickDefaultMembership(memberships);
}
