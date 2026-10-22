"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scoped } from "@/lib/org/context";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const categorySchema = z.object({
  name: z.string().min(1),
  unit: z.string().trim().optional(),
});

export async function createCategory(formData: FormData) {
  const user = await requirePermission("category:manage");
  const db = scoped(user);

  const parsed = categorySchema.parse({
    name: formData.get("name"),
    unit: formData.get("unit") || undefined,
  });

  const created = await db.category.create({ data: { ...parsed, organizationId: user.orgId } });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "CATEGORY_CREATED",
    module: "CATEGORY",
    entityId: created.id,
    details: { name: created.name },
  });

  revalidatePath("/categories");
}
