"use server";

import { checkStepUp } from "@/lib/security/step-up";
import { needsProjects, ROLES, type RoleName } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { scoped } from "@/lib/org/context";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { checkPassword } from "@/lib/security/password";
import { assertCanAddUsers } from "@/lib/plans/entitlements";
import { normalizePhone } from "@/lib/security/phone";

// Users are global people (one sign-in); what they may do in a company lives on
// their Membership. Everything here is limited to the signed-in admin's company.

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(1, "Enter a password"),
  phone: z.string().optional(),
  role: z.enum(ROLES),
  projectIds: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  phone: z.string().optional(),
  role: z.enum(ROLES),
  projectIds: z.array(z.string()).default([]),
});

/** Every project id must exist in this company. */
async function assertProjectsInOrg(
  db: ReturnType<typeof scoped>,
  projectIds: string[]
) {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return;
  const count = await db.project.count({ where: { id: { in: unique } } });
  if (count !== unique.length) {
    throw new AppError("VALIDATION_001", "One or more selected projects were not found.");
  }
}

/** The user must be a member of the admin's company, otherwise they do not exist for this admin. */
async function loadMember(orgId: string, userId: string) {
  const membership = await rawDb.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    include: { user: true },
  });
  if (!membership) throw new AppError("NOT_FOUND_001", "User not found");
  return membership;
}

/** An optional number, read as one of the company's country when it has no + (see lib/security/phone.ts). Empty means none. */
async function cleanPhone(orgId: string, raw: string | undefined): Promise<string | null> {
  if (!raw || !raw.trim()) return null;
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: { country: true } });
  const r = normalizePhone(raw, org?.country ?? "IN");
  if (!r.ok) throw new AppError("VALIDATION_001", r.error);
  return r.phone;
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: RoleName;
  projectIds: string[];
}) {
  const admin = await requireAdmin();
  const db = scoped(admin);
  const parsed = createSchema.parse(input);

  const email = parsed.email.toLowerCase();
  const existing = await rawDb.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(
      "VALIDATION_001",
      "This email already has an account. Use Invite someone above: they accept with their own password and keep the other company they belong to.",
    );
  }
  const phone = await cleanPhone(admin.orgId, parsed.phone);

  const problem = checkPassword(parsed.password, { email, name: parsed.name });
  if (problem) throw new AppError("VALIDATION_001", problem);
  const passwordHash = await bcrypt.hash(parsed.password, 12);
  const projectIds = needsProjects(parsed.role) ? parsed.projectIds : [];
  await assertProjectsInOrg(db, projectIds);

  // The plan limits how many people a company may have. Checked in the same transaction (company locked)
  // as the insert, so two administrators cannot both add the last person.
  // Scoped client: the nested project assignments are company rows protected by Row-Level Security.
  const created = await db.$transaction(async (tx) => {
    await assertCanAddUsers(tx, admin.orgId);
    return tx.user.create({
      data: {
        name: parsed.name,
        email,
        phone,
        passwordHash,
        role: parsed.role,
        emailVerifiedAt: new Date(), // created by an administrator, who vouches for the address
        memberships: { create: { organizationId: admin.orgId, role: parsed.role } },
        projectAssignments:
          projectIds.length > 0
            ? {
                // nested rows are not stamped automatically
                create: projectIds.map((projectId) => ({
                  projectId,
                  organizationId: admin.orgId,
                })),
              }
            : undefined,
      },
    });
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "USER_CREATED",
    module: "USER",
    entityId: created.id,
    details: { email: created.email, role: created.role },
  });

  revalidatePath("/users");
}

export async function updateUser(input: {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: RoleName;
  projectIds: string[];
}) {
  const admin = await requireAdmin();
  const db = scoped(admin);
  const parsed = updateSchema.parse(input);

  const membership = await loadMember(admin.orgId, parsed.id);
  const user = membership.user;
  const email = parsed.email.toLowerCase();

  // A person who also belongs to other companies keeps one profile and one
  // password across all of them: this admin may only change role and projects.
  const otherCompanies = await rawDb.membership.count({
    where: { userId: user.id, organizationId: { not: admin.orgId } },
  });
  const phone = await cleanPhone(admin.orgId, parsed.phone);
  const profileChange = parsed.name !== user.name || email !== user.email || phone !== (user.phone ?? null);
  if (otherCompanies > 0 && profileChange) {
    throw new AppError(
      "VALIDATION_001",
      "This person also belongs to other companies. You can change their role and projects here; their name, email and phone can only be changed by them."
    );
  }

  // A company must always keep an administrator: nobody could reach settings, users or the plan page otherwise.
  if (membership.role === "ADMIN" && parsed.role !== "ADMIN") {
    const otherAdmins = await rawDb.membership.count({
      where: { organizationId: admin.orgId, role: "ADMIN", userId: { not: parsed.id }, user: { deletedAt: null } },
    });
    if (otherAdmins === 0) {
      throw new AppError("VALIDATION_001", "This is the only administrator. Make someone else an administrator first, then change this role.");
    }
  }

  const emailTaken = await rawDb.user.findFirst({
    where: { email, id: { not: parsed.id } },
  });
  if (emailTaken) throw new AppError("VALIDATION_001", "A user with this email already exists");

  const projectIds = needsProjects(parsed.role) ? parsed.projectIds : [];
  await assertProjectsInOrg(db, projectIds);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        email,
        ...(otherCompanies === 0 ? { phone } : {}),
        // legacy column: only for people who belong to this company alone (otherwise it would overwrite their role elsewhere)
        ...(otherCompanies === 0 ? { role: parsed.role } : {}),
      },
    });
    await tx.membership.update({
      where: { userId_organizationId: { userId: parsed.id, organizationId: admin.orgId } },
      data: { role: parsed.role },
    });
    // only this company's assignments are replaced
    await tx.projectAssignment.deleteMany({
      where: { userId: parsed.id, organizationId: admin.orgId },
    });
    if (projectIds.length > 0) {
      await tx.projectAssignment.createMany({
        data: projectIds.map((projectId) => ({
          userId: parsed.id,
          projectId,
          organizationId: admin.orgId,
        })),
      });
    }
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "USER_UPDATED",
    module: "USER",
    entityId: parsed.id,
    details: { email, role: parsed.role },
  });

  revalidatePath("/users");
}

/** Removing a person needs a confirmation code from email (see lib/security/step-up.ts). Returns what happened instead of throwing, so the screen can ask for the code. */
export async function deleteUser(userId: string, code?: string): Promise<{ ok: true } | { ok: false; error: string; needsCode?: true }> {
  const admin = await requireAdmin();
  const step = await checkStepUp(admin.id, code);
  if (!step.ok) return step;
  try {
    await removeUser(admin, userId);
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message };
    throw error;
  }
}

async function removeUser(admin: { id: string; orgId: string }, userId: string) {
  const db = scoped(admin);
  if (admin.id === userId) {
    throw new AppError("VALIDATION_001", "You cannot delete your own account");
  }

  const membership = await loadMember(admin.orgId, userId);
  const user = membership.user;

  // Work done in THIS company (other companies' invoices are none of our business).
  const workInThisCompany = await db.invoice.count({
    where: { OR: [{ uploadedById: userId }, { reviewedById: userId }] },
  });
  if (workInThisCompany > 0) {
    throw new AppError(
      "VALIDATION_001",
      "Cannot delete a user who has uploaded or reviewed invoices. Reassign their work first."
    );
  }

  const otherCompanies = await rawDb.membership.count({
    where: { userId, organizationId: { not: admin.orgId } },
  });

  await db.$transaction(async (tx) => {
    await tx.projectAssignment.deleteMany({
      where: { userId, organizationId: admin.orgId },
    });
    await tx.membership.delete({
      where: { userId_organizationId: { userId, organizationId: admin.orgId } },
    });
    // The person account is removed only when no other company still uses it.
    if (otherCompanies === 0) {
      await tx.user.delete({ where: { id: userId } });
    }
  });

  await logActivity({
    userId: admin.id,
    organizationId: admin.orgId,
    action: "USER_DELETED",
    module: "USER",
    entityId: userId,
    details: { email: user.email, removedFromCompanyOnly: otherCompanies > 0 },
  });

  revalidatePath("/users");
}
