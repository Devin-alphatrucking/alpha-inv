"use server";

import { revalidatePath } from "next/cache";
import { signOut, unstable_update } from "@/lib/auth";
import { requireAdmin, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { changePassword, closeCompany, deleteAccount, listMyCompanies, signOutEverywhere } from "@/lib/flows/account";

// Every action works on the SIGNED-IN person only: the user id and company come from the session, never from the browser.

export async function changePasswordAction(current: string, next: string) {
  const user = await requireUser();
  const result = await changePassword(user.id, current, next);
  // Keep THIS session working (other devices are signed out by the version bump).
  if (result.ok) await unstable_update({ refreshSv: true } as never);
  return result;
}

export async function signOutEverywhereAction() {
  const user = await requireUser();
  await signOutEverywhere(user.id);
  await signOut({ redirectTo: "/login" });
}

export async function deleteAccountAction(password: string) {
  const user = await requireUser();
  const result = await deleteAccount(user.id, password);
  if (!result.ok) return result;
  await signOut({ redirectTo: "/login" });
  return result;
}

export async function closeCompanyAction(password: string) {
  const admin = await requireAdmin();
  const result = await closeCompany({ id: admin.id, orgId: admin.orgId }, password);
  if (!result.ok) return result;
  await signOut({ redirectTo: "/login" });
  return result;
}

export async function switchCompanyAction(orgId: string) {
  const user = await requireUser();
  const mine = await listMyCompanies(user.id);
  if (!mine.some((c) => c.id === orgId)) return { ok: false as const, error: "You do not belong to that company." };
  await unstable_update({ switchOrgId: orgId } as never);
  await logActivity({ userId: user.id, organizationId: orgId, action: "COMPANY_SWITCHED", module: "AUTH", entityId: orgId });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
