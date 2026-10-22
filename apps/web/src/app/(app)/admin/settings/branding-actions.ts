"use server";

import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { brandingSchema } from "@/lib/brand/validation";
import { MAX_LOGO_BYTES, detectLogoType } from "@/lib/brand/logo";

// Company branding and regional settings. Only an ADMIN of the company can change
// them, and only their own company's row is ever touched (the company id comes from
// the signed session, never from the browser). Organization is not a Row-Level
// Security table, so that rule is enforced here.

export type BrandingResult = { ok: true } | { ok: false; error: string };

export async function saveBranding(input: Record<string, unknown>): Promise<BrandingResult> {
  const admin = await requireAdmin();
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const v = parsed.data;

  // Reject a currency Intl does not know.
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: v.currency });
  } catch {
    return { ok: false, error: "Unknown currency code." };
  }

  await rawDb.organization.update({
    where: { id: admin.orgId },
    data: {
      displayName: v.displayName ?? null,
      primaryColor: v.primaryColor ?? null,
      accentColor: v.accentColor ?? null,
      supportEmail: v.supportEmail ?? null,
      supportUrl: v.supportUrl ?? null,
      country: v.country,
      currency: v.currency,
      timezone: v.timezone,
    },
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "COMPANY_UPDATED",
    module: "COMPANY",
    entityId: admin.orgId,
    details: { fields: ["branding", "region"] },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function uploadLogo(formData: FormData): Promise<BrandingResult> {
  const admin = await requireAdmin();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: `The logo must be ${Math.round(MAX_LOGO_BYTES / 1024)} KB or smaller.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(bytes);
  if (!type) {
    return { ok: false, error: "Use a PNG, JPEG or WebP image (SVG is not accepted)." };
  }

  const org = await rawDb.organization.findUnique({ where: { id: admin.orgId }, select: { slug: true } });
  if (!org) return { ok: false, error: "Company not found." };

  await rawDb.$transaction([
    rawDb.organizationLogo.upsert({
      where: { organizationId: admin.orgId },
      create: { organizationId: admin.orgId, contentType: type, data: bytes },
      update: { contentType: type, data: bytes },
    }),
    rawDb.organization.update({
      where: { id: admin.orgId },
      // the version in the URL makes browsers pick up a replaced logo immediately
      data: { logoUrl: `/api/branding/logo/${org.slug}?v=${Date.now()}` },
    }),
  ]);

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "COMPANY_UPDATED",
    module: "COMPANY",
    entityId: admin.orgId,
    details: { fields: ["logo"], bytes: bytes.length, type },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeLogo(): Promise<BrandingResult> {
  const admin = await requireAdmin();
  await rawDb.$transaction([
    rawDb.organizationLogo.deleteMany({ where: { organizationId: admin.orgId } }),
    rawDb.organization.update({ where: { id: admin.orgId }, data: { logoUrl: null } }),
  ]);
  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "COMPANY_UPDATED",
    module: "COMPANY",
    entityId: admin.orgId,
    details: { fields: ["logo"], removed: true },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
