"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { createInvite, revokeInvite } from "@/lib/flows/invite";

// Only an ADMIN of the company may invite or cancel; the company comes from the session.

export async function inviteUserAction(input: Record<string, unknown>) {
  const admin = await requireAdmin();
  const result = await createInvite({ id: admin.id, name: admin.name || "An administrator", orgId: admin.orgId }, input);
  revalidatePath("/users");
  return result;
}

export async function revokeInviteAction(inviteId: string) {
  const admin = await requireAdmin();
  const result = await revokeInvite({ id: admin.id, name: admin.name || "An administrator", orgId: admin.orgId }, inviteId);
  revalidatePath("/users");
  return result;
}
