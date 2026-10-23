"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { assertProjectAccess } from "@/lib/projects/access";
import { scoped } from "@/lib/org/context";
import { parseBudgetInput } from "@/lib/projects/budget";
import { assertUsersInOrg } from "@/lib/org/members";
import { encryptSecret } from "@/lib/crypto";
import { validateAzureEndpoint } from "@/lib/azure/project-credentials";
import { assertCanAddProject, assertProjectPageLimit, getEntitlements } from "@/lib/plans/entitlements";

const projectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  description: z.string().trim().optional(),
  address: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  userIds: z.array(z.string()).default([]),
  // Spending limit. Undefined = leave as it is; blank or 0 = no budget.
  budget: z.union([z.string(), z.number()]).nullish(),
  // AI settings (admin only). Blank key = keep the saved one.
  azureEndpoint: z.string().trim().optional(),
  azureKey: z.string().trim().optional(),
  clearAzureKey: z.boolean().optional(),
  monthlyPageLimit: z.coerce
    .number()
    .int("Page limit must be a whole number")
    .min(0)
    .max(1_000_000)
    .optional(),
});

/** Builds the Prisma fields for the AI settings; never returns the plain key. */
function aiFields(parsed: z.infer<typeof projectSchema>) {
  const data: {
    azureEndpoint?: string | null;
    azureKeyEnc?: string | null;
    azureKeyHint?: string | null;
    monthlyPageLimit?: number;
  } = {};

  if (parsed.monthlyPageLimit !== undefined) {
    data.monthlyPageLimit = parsed.monthlyPageLimit;
  }

  if (parsed.clearAzureKey) {
    data.azureEndpoint = null;
    data.azureKeyEnc = null;
    data.azureKeyHint = null;
    return { data, keyChanged: true };
  }

  if (parsed.azureEndpoint) {
    data.azureEndpoint = validateAzureEndpoint(parsed.azureEndpoint);
  }
  if (parsed.azureKey) {
    data.azureKeyEnc = encryptSecret(parsed.azureKey);
    data.azureKeyHint = parsed.azureKey.slice(-4);
  }
  return { data, keyChanged: Boolean(parsed.azureKey) };
}

type ProjectStatusValue = "ACTIVE" | "COMPLETED" | "ARCHIVED";

function normalizeStatus(status: string | undefined): ProjectStatusValue {
  return status === "ACTIVE" || status === "COMPLETED" || status === "ARCHIVED"
    ? status
    : "ACTIVE";
}

type AiInput = {
  budget?: string | number | null;
  azureEndpoint?: string;
  azureKey?: string;
  clearAzureKey?: boolean;
  monthlyPageLimit?: number;
};

export async function createProject(input: {
  name: string;
  description?: string;
  address?: string;
  status?: string;
  userIds: string[];
} & AiInput) {
  const admin = await requirePermission("project:manage");
  const db = scoped(admin);

  const parsed = projectSchema.parse(input);
  const status = normalizeStatus(parsed.status);
  const ai = aiFields(parsed);
  const budget = parseBudgetInput(parsed.budget);
  if (!budget.ok) throw new AppError("VALIDATION_001", budget.error);
  await assertUsersInOrg(admin.orgId, parsed.userIds);

  const created = await db.$transaction(async (tx) => {
    // The plan decides how many active projects a company may have (and the AI pages each gets).
    // Checked inside the transaction, with the company locked, so two requests cannot both take the last place.
    const plan =
      status === "ACTIVE" ? await assertCanAddProject(tx, admin.orgId) : await getEntitlements(admin.orgId, tx);
    const pages = ai.data.monthlyPageLimit ?? plan.limits.aiPagesPerProject;
    assertProjectPageLimit(plan, pages);

    const project = await tx.project.create({
      data: {
        ...ai.data,
        monthlyPageLimit: pages,
        budget: budget.value,
        organizationId: admin.orgId,
        name: parsed.name,
        description: parsed.description || null,
        address: parsed.address || null,
        status,
        assignments:
          parsed.userIds.length > 0
            ? {
                // nested rows are not stamped automatically
                create: parsed.userIds.map((userId) => ({
                  userId,
                  organizationId: admin.orgId,
                })),
              }
            : undefined,
      },
    });
    return project;
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "PROJECT_CREATED",
    module: "PROJECT",
    entityId: created.id,
    details: {
      name: created.name,
      userIds: parsed.userIds,
      azureKeyChanged: ai.keyChanged,
      monthlyPageLimit: created.monthlyPageLimit,
    },
  });

  revalidatePath("/projects");
  // Return plain fields only (the encrypted key must not reach the browser).
  return { id: created.id, name: created.name };
}

export async function updateProject(input: {
  id: string;
  name: string;
  description?: string;
  address?: string;
  status?: string;
  userIds: string[];
} & AiInput) {
  const admin = await requirePermission("project:manage");
  const db = scoped(admin);

  const projectId = input.id;
  if (!projectId) throw new AppError("VALIDATION_001", "Project id is required");

  const parsed = projectSchema.parse(input);
  const status = normalizeStatus(parsed.status);
  const ai = aiFields(parsed);
  const budget = parseBudgetInput(parsed.budget);
  if (!budget.ok) throw new AppError("VALIDATION_001", budget.error);
  await assertUsersInOrg(admin.orgId, parsed.userIds);

  const existing = await db.project.findUnique({ where: { id: projectId } });
  if (!existing) throw new AppError("NOT_FOUND_001", "Project not found");

  // A company admin may lower a project's AI page limit, never raise it above what the plan includes.
  if (parsed.monthlyPageLimit !== undefined && parsed.monthlyPageLimit !== existing.monthlyPageLimit) {
    assertProjectPageLimit(await getEntitlements(admin.orgId), parsed.monthlyPageLimit);
  }

  await db.$transaction(async (tx) => {
    // Bringing a completed or archived project back to ACTIVE takes a place again.
    if (existing.status !== "ACTIVE" && status === "ACTIVE") await assertCanAddProject(tx, admin.orgId);
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...ai.data,
        name: parsed.name,
        description: parsed.description || null,
        address: parsed.address || null,
        status,
        ...(parsed.budget !== undefined ? { budget: budget.value } : {}),
      },
    });
    await tx.projectAssignment.deleteMany({ where: { projectId } });
    if (parsed.userIds.length > 0) {
      await tx.projectAssignment.createMany({
        data: parsed.userIds.map((userId) => ({
          organizationId: admin.orgId,
          userId,
          projectId,
        })),
      });
    }
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "PROJECT_UPDATED",
    module: "PROJECT",
    entityId: projectId,
    details: {
      name: parsed.name,
      userIds: parsed.userIds,
      azureKeyChanged: ai.keyChanged,
      monthlyPageLimit: parsed.monthlyPageLimit,
      budget: parsed.budget !== undefined ? budget.value : undefined,
    },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/invoices/upload");
}

export async function deleteProject(projectId: string) {
  const admin = await requirePermission("project:manage");
  const db = scoped(admin);

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { _count: { select: { invoices: true } } },
  });
  if (!project) throw new AppError("NOT_FOUND_001", "Project not found");

  if (project._count.invoices > 0) {
    throw new AppError(
      "PROJECT_001",
      "Cannot delete a project that has invoices. Reassign the invoices first."
    );
  }

  await db.project.delete({ where: { id: projectId } });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "PROJECT_DELETED",
    module: "PROJECT",
    entityId: projectId,
    details: { name: project.name },
  });

  revalidatePath("/projects");
}

export async function addProjectNote(input: {
  projectId: string;
  content: string;
}) {
  const user = await requirePermission("project:view");
  const db = scoped(user);
  const content = input.content?.trim();
  if (!content) throw new AppError("VALIDATION_001", "Note content is required");

  await assertProjectAccess(input.projectId, user);

  const note = await db.projectNote.create({
    data: {
      organizationId: user.orgId,
      projectId: input.projectId,
      userId: user.id,
      content,
    },
  });

  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "PROJECT_NOTE_ADDED",
    module: "PROJECT",
    entityId: input.projectId,
    details: { noteId: note.id },
  });

  revalidatePath(`/projects/${input.projectId}`);
  return note;
}
