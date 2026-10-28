"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/permissions";
import { checkStepUp } from "@/lib/security/step-up";
import { clientIp } from "@/lib/security/rate-limit";
import { setEmployeePassword, sendEmployeeResetLink } from "@/lib/flows/employee-password";

// The administrator is the signed-in person (from the session, never from the browser); the colleague is looked up inside this company only.

type Outcome = { ok: true; message?: string } | { ok: false; error: string; field?: string; needsCode?: true };

/** Sets a colleague's password. Needs the administrator's emailed confirmation code first. */
export async function setUserPasswordAction(userId: string, password: string, code?: string): Promise<Outcome> {
  const admin = await requireAdmin();
  const step = await checkStepUp(admin.id, code);
  if (!step.ok) return step;
  const r = await setEmployeePassword({ id: admin.id, orgId: admin.orgId, name: admin.name ?? "An administrator" }, userId, password);
  if (r.ok) revalidatePath("/users");
  return r.ok ? { ok: true, message: "Password changed. They are signed out of every device and have been emailed." } : r;
}

/** Emails a colleague a reset link and code (they choose their own new password). */
export async function sendUserResetLinkAction(userId: string): Promise<Outcome> {
  const admin = await requireAdmin();
  const r = await sendEmployeeResetLink({ id: admin.id, orgId: admin.orgId, name: admin.name ?? "An administrator" }, userId, { ip: clientIp(await headers()) });
  return r.ok ? { ok: true, message: r.message } : r;
}
