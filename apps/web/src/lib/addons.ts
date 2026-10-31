import { cache } from "react";
import { redirect } from "next/navigation";
import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";

/**
 * Optional add-on modules. Each company switches them on or off itself (an administrator, under Settings, Add-on modules); they are OFF
 * until then. An add-on stands on its own: it has its own data and never reads or writes the Accounts, Purchase or Site modules, so a
 * company can use it, or ignore it, without any effect on the rest.
 */
export const ADDONS = [
  {
    key: "sales",
    name: "Sales invoices",
    description: "Issue GST tax invoices to your own customers: CGST, SGST or IGST worked out for you, a printable invoice, payments received, and a GSTR-1 style download for your accountant.",
    href: "/sales",
  },
] as const;

export type AddonKey = (typeof ADDONS)[number]["key"];

export const isAddonKey = (value: unknown): value is AddonKey => ADDONS.some((a) => a.key === value);

/** The add-ons a company has switched on (unknown names, from an older or newer version, are ignored). Read once per request. */
export const enabledAddons = cache(async (orgId: string): Promise<AddonKey[]> => {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { addons: true } });
  return (org?.addons ?? []).filter(isAddonKey);
});

export async function isAddonOn(orgId: string, key: AddonKey) {
  return (await enabledAddons(orgId)).includes(key);
}

/** For pages and actions of an add-on: sends people to the switch page when the company has not turned it on. */
export async function requireAddon(orgId: string, key: AddonKey) {
  if (!(await isAddonOn(orgId, key))) redirect("/admin/add-ons");
}

/** Switches an add-on on or off for a company. Turning one off hides it; its data stays, ready if it is switched on again. */
export async function setAddon(orgId: string, userId: string, key: AddonKey, on: boolean) {
  const org = await rawDb.organization.findUniqueOrThrow({ where: { id: orgId }, select: { addons: true } });
  const current = new Set(org.addons.filter(isAddonKey));
  if (on) current.add(key);
  else current.delete(key);
  await rawDb.organization.update({ where: { id: orgId }, data: { addons: [...current] } });
  await logActivity({ userId, organizationId: orgId, action: on ? "ADDON_ENABLED" : "ADDON_DISABLED", module: "COMPANY", entityId: orgId, details: { addon: key } });
}
