"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/permissions";
import { updateMyPhone } from "@/lib/flows/phone";

/** Changes the signed-in person's own mobile number (the person and company come from the session). */
export async function updatePhoneAction(raw: string) {
  const user = await requireUser({ allowLocked: true });
  const r = await updateMyPhone(user.id, raw, user.orgId);
  if (r.ok) revalidatePath("/account");
  return r;
}
