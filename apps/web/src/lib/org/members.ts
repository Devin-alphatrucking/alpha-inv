import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Throws unless every id belongs to a member of the company. Use before
 * assigning users to projects or anything else that references user ids sent
 * by the browser (the client must never be able to name a user from another company).
 */
export async function assertUsersInOrg(orgId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await rawDb.membership.count({
    where: { organizationId: orgId, userId: { in: unique } },
  });
  if (count !== unique.length) {
    throw new AppError("VALIDATION_001", "One or more selected users do not belong to this company.");
  }
}
