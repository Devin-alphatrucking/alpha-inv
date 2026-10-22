"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const vendorSchema = z.object({
  name: z.string().trim().min(1, "Enter the vendor name.").max(160),
  // GSTIN is stored in capitals so "27abc..." and "27ABC..." are the same vendor.
  gstin: z.string().trim().toUpperCase().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  contact: z.string().trim().max(120).optional(),
});

export type VendorResult = { ok: true } | { ok: false; error: string };

export async function createVendor(formData: FormData): Promise<VendorResult> {
  const user = await requirePermission("vendor:manage");
  const db = scoped(user);

  const parsed = vendorSchema.safeParse({
    name: formData.get("name"),
    gstin: formData.get("gstin") || undefined,
    address: formData.get("address") || undefined,
    contact: formData.get("contact") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the vendor details." };

  if (parsed.data.gstin) {
    const existing = await db.vendor.findFirst({ where: { gstin: parsed.data.gstin } });
    if (existing) return { ok: false, error: `A vendor with GSTIN "${parsed.data.gstin}" already exists (${existing.name}).` };
  }

  let created;
  try {
    created = await db.vendor.create({ data: { ...parsed.data, organizationId: user.orgId } });
  } catch (error) {
    // Two people adding the same GSTIN at the same moment.
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "A vendor with this GSTIN already exists." };
    throw error;
  }

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "VENDOR_CREATED",
    module: "VENDOR",
    entityId: created.id,
    details: { name: created.name },
  });

  revalidatePath("/vendors");
  return { ok: true };
}

export async function deleteVendor(vendorId: string) {
  const user = await requirePermission("vendor:manage");
  const db = scoped(user);

  const count = await db.invoice.count({ where: { vendorId } });
  if (count > 0) {
    throw new AppError(
      "VALIDATION_001",
      "Cannot delete a vendor that has invoices."
    );
  }

  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError("NOT_FOUND_001", "Vendor not found");

  await db.vendor.delete({ where: { id: vendorId } });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "VENDOR_DELETED",
    module: "VENDOR",
    entityId: vendorId,
    details: { name: vendor.name },
  });

  revalidatePath("/vendors");
}
