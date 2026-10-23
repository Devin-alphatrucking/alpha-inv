"use server";

import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireUser } from "@/lib/permissions";

// Works on the SIGNED-IN person only (id from the session).
export async function setEmailDigestAction(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser({ allowLocked: true });
    await rawDb.user.update({ where: { id: user.id }, data: { emailDigest: enabled === true } });
    revalidatePath("/account");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save. Please try again." };
  }
}
