"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter the category name.").max(80),
  unit: z.string().trim().toUpperCase().max(20).optional(),
});

export type CategoryResult = { ok: true } | { ok: false; error: string };

export async function createCategory(formData: FormData): Promise<CategoryResult> {
  const user = await requirePermission("category:manage");
  const db = scoped(user);

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    unit: formData.get("unit") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the category details." };

  // Names are unique per company, ignoring capitals.
  const existing = await db.category.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } } });
  if (existing) return { ok: false, error: `A category named "${existing.name}" already exists.` };

  let created;
  try {
    created = await db.category.create({ data: { ...parsed.data, organizationId: user.orgId } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "A category with this name already exists." };
    throw error;
  }

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "CATEGORY_CREATED",
    module: "CATEGORY",
    entityId: created.id,
    details: { name: created.name },
  });

  revalidatePath("/categories");
  return { ok: true };
}
