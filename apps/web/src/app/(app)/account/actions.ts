"use server";

import { createOwnCompany } from "@/lib/flows/company-create";
import { checkStepUp } from "@/lib/security/step-up";
import { revalidatePath } from "next/cache";
import { serverUpdateProof, signOut, unstable_update } from "@/lib/auth";
import { requireAdmin, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { changePassword, closeCompany, deleteAccount, listMyCompanies, signOutEverywhere } from "@/lib/flows/account";

// Every action works on the SIGNED-IN person only: the user id and company come from the session, never from the browser.

export async function changePasswordAction(current: string, next: string) {
  const user = await requireUser({ allowLocked: true });
  const result = await changePassword(user.id, current, next);
  // Keep THIS session working (other devices are signed out by the version bump).
  if (result.ok) await unstable_update({ refreshSv: true, serverProof: serverUpdateProof() } as never);
  return result;
}

export async function signOutEverywhereAction() {
  const user = await requireUser({ allowLocked: true });
  await signOutEverywhere(user.id);
  await signOut({ redirectTo: "/login" });
}

export async function deleteAccountAction(password: string, code?: string) {
  const user = await requireUser({ allowLocked: true });
  const step = await checkStepUp(user.id, code);
  if (!step.ok) return step;
  const result = await deleteAccount(user.id, password);
  if (!result.ok) return result;
  await signOut({ redirectTo: "/login" });
  return result;
}

export async function closeCompanyAction(password: string, code?: string) {
  const admin = await requireAdmin({ allowLocked: true });
  const step = await checkStepUp(admin.id, code);
  if (!step.ok) return step;
  const result = await closeCompany({ id: admin.id, orgId: admin.orgId }, password);
  if (!result.ok) return result;
  await signOut({ redirectTo: "/login" });
  return result;
}

/** Starts a company of the signed-in person's own (see lib/flows/company-create.ts) and moves this session into it. */
export async function createOwnCompanyAction(input: { companyName: string; country: string }) {
  const user = await requireUser({ allowLocked: true });
  const result = await createOwnCompany({ id: user.id }, input);
  if (!result.ok) return result;
  await unstable_update({ switchOrgId: result.orgId } as never);
  await logActivity({ userId: user.id, organizationId: result.orgId, action: "COMPANY_SWITCHED", module: "AUTH", entityId: result.orgId });
  revalidatePath("/", "layout");
  return result;
}

export async function switchCompanyAction(orgId: string) {
  const user = await requireUser({ allowLocked: true });
  const mine = await listMyCompanies(user.id);
  if (!mine.some((c) => c.id === orgId)) return { ok: false as const, error: "You do not belong to that company." };
  await unstable_update({ switchOrgId: orgId } as never);
  await logActivity({ userId: user.id, organizationId: orgId, action: "COMPANY_SWITCHED", module: "AUTH", entityId: orgId });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
