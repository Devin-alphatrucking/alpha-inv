"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { isAddonKey, setAddon } from "@/lib/addons";

/** Switches an optional module on or off for the administrator's company. */
export async function toggleAddon(key: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAdmin();
  if (!isAddonKey(key)) return { ok: false, error: "That module does not exist." };
  await setAddon(user.orgId, user.id, key, on);
  // The menu is drawn by the layout, so every page must be drawn again.
  revalidatePath("/", "layout");
  return { ok: true };
}
