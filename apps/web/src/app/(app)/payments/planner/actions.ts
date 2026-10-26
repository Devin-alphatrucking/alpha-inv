"use server";

import { checkStepUp } from "@/lib/security/step-up";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { recordPayRun } from "@/lib/flows/pay-run";

// The person and the company come from the signed session, never from the browser. Needs the payment planner permission (administrator, accountant).
export async function recordPayRunAction(input: { items: { invoiceId: string; amount: number }[]; paidOn: string; mode?: string; reference?: string }, code?: string) {
  const admin = await requirePermission("payment:plan");
  // Money going out: confirm it is you (once per 15 minutes) with a code from email.
  const step = await checkStepUp(admin.id, code);
  if (!step.ok) return step;
  const result = await recordPayRun({ id: admin.id, orgId: admin.orgId, role: admin.role }, input);
  if (result.ok && result.paid > 0) {
    for (const path of ["/payments", "/payments/planner", "/invoices", "/dashboard", "/projects"]) revalidatePath(path);
  }
  return result;
}
