"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { scoped } from "@/lib/org/context";
import { deleteInvoiceFiles } from "@/lib/azure/blob";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { setCompanyPageLimit } from "@/lib/usage/pages";
import { assertCompanyPageCap, getEntitlements } from "@/lib/plans/entitlements";
import { AppError } from "@/lib/errors";
import { PROJECT_SCOPE_COOKIE } from "@/lib/projects/scope";

const resetSchema = z.object({
  password: z.string().min(1),
  confirmation: z.literal("RESET DATA"),
});

export type ResetDataResult =
  | { ok: true; fileCleanupFailures: number }
  | { ok: false; error: string };

export async function resetApplicationData(input: {
  password: string;
  confirmation: string;
}): Promise<ResetDataResult> {
  const admin = await requireAdmin();
  const db = scoped(admin);
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter your password and the exact confirmation phrase." };
  }

  const account = await rawDb.user.findUnique({
    where: { id: admin.id },
    select: { passwordHash: true },
  });
  if (!account || !(await bcrypt.compare(parsed.data.password, account.passwordHash))) {
    return { ok: false, error: "The current admin password is incorrect." };
  }

  const invoiceFiles = await db.invoice.findMany({ select: { fileUrl: true } });

  // People who belong ONLY to this company (never the admin running this).
  const onlyHere = await rawDb.user.findMany({
    where: {
      id: { not: admin.id },
      memberships: { some: { organizationId: admin.orgId }, none: { organizationId: { not: admin.orgId } } },
    },
    select: { id: true },
  });
  const onlyHereIds = onlyHere.map((u) => u.id);

  // Every deleteMany on a company table below is limited to THIS company by the scoped client.
  await db.$transaction(async (tx) => {
    await tx.auditLog.deleteMany();
    await tx.payment.deleteMany();
    await tx.invoiceLineItem.deleteMany();
    await tx.invoice.deleteMany();
    await tx.projectNote.deleteMany();
    await tx.projectAssignment.deleteMany();
    await tx.activityLog.deleteMany();
    await tx.apiErrorLog.deleteMany();
    await tx.material.deleteMany();
    await tx.category.deleteMany();
    await tx.vendor.deleteMany();
    await tx.project.deleteMany();
  });
  // Company-less tables are handled outside the scoped client, still per company.
  await rawDb.membership.deleteMany({
    where: { organizationId: admin.orgId, userId: { not: admin.id } },
  });
  if (onlyHereIds.length > 0) {
    await rawDb.user.deleteMany({ where: { id: { in: onlyHereIds } } });
  }

  (await cookies()).delete(PROJECT_SCOPE_COOKIE);
  const failures = await deleteInvoiceFiles(invoiceFiles.map((file) => file.fileUrl));
  return { ok: true, fileCleanupFailures: failures.length };
}

/** Company-wide monthly AI page cap. Empty/null removes the cap. */
export async function updateCompanyPageLimit(
  limit: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  if (limit !== null) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000) {
      return { ok: false, error: "Enter a whole number of pages (0 or more)." };
    }
  }
  if (limit !== null) {
    try {
      assertCompanyPageCap(await getEntitlements(admin.orgId), limit);
    } catch (error) {
      if (error instanceof AppError && error.code === "PLAN_001") return { ok: false, error: error.message };
      throw error;
    }
  }
  await setCompanyPageLimit(admin.orgId, limit);
  revalidatePath("/admin/settings");
  return { ok: true };
}
