import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { normalizePhone } from "@/lib/security/phone";
import type { FlowResult } from "@/lib/flows/schemas";

/** The signed-in person changes their own mobile number. A number without a + is read as a number of the company's country. */
export async function updateMyPhone(userId: string, raw: unknown, orgId: string): Promise<FlowResult<{ phone: string }>> {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { country: true } });
  const phone = normalizePhone(raw, org?.country ?? "IN");
  if (!phone.ok) return { ok: false, error: phone.error, field: "phone" };
  await rawDb.user.update({ where: { id: userId }, data: { phone: phone.phone } });
  await logActivity({ userId, organizationId: orgId, action: "PHONE_UPDATED", module: "AUTH", entityId: userId });
  return { ok: true, phone: phone.phone };
}
