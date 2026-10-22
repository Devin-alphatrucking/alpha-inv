import { rawDb } from "@/lib/db";

/** The company's time zone (for "is this invoice past due"). Falls back to UTC. */
export async function companyTimeZone(orgId: string): Promise<string> {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return org?.timezone || "UTC";
}
