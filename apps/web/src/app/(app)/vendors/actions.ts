"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const vendorSchema = z.object({
  name: z.string().min(1),
  gstin: z.string().trim().optional(),
  address: z.string().trim().optional(),
  contact: z.string().trim().optional(),
});

export async function createVendor(formData: FormData) {
  const user = await requirePermission("vendor:manage");
  const db = scoped(user);

  const parsed = vendorSchema.parse({
    name: formData.get("name"),
    gstin: formData.get("gstin") || undefined,
    address: formData.get("address") || undefined,
    contact: formData.get("contact") || undefined,
  });

  if (parsed.gstin) {
    const existing = await db.vendor.findFirst({ where: { gstin: parsed.gstin } });
    if (existing) {
      throw new AppError("VALIDATION_001", `A vendor with GSTIN "${parsed.gstin}" already exists (${existing.name}).`);
    }
  }

  const created = await db.vendor.create({ data: { ...parsed, organizationId: user.orgId } });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "VENDOR_CREATED",
    module: "VENDOR",
    entityId: created.id,
    details: { name: created.name },
  });

  revalidatePath("/vendors");
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
    action: "VENDOR_CREATED",
    module: "VENDOR",
    entityId: vendorId,
    details: { name: vendor.name, deleted: true },
  });

  revalidatePath("/vendors");
}
