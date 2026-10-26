import { seesAllProjects, type RoleName } from "@/lib/roles";
import type { Prisma } from "@alpha/db";
import { dbFor } from "@/lib/org/scoped-db";
import { AppError } from "@/lib/errors";

export type ProjectUser = { id: string; role: RoleName; orgId: string };

/** Prisma where clause for projects visible to the current user (inside their company). */
export function projectAccessWhere(user: ProjectUser): Prisma.ProjectWhereInput {
  if (seesAllProjects(user.role)) return {};
  return {
    assignments: { some: { userId: user.id } },
  };
}

/** Verifies the user can access a project in their company, returning it or throwing. */
export async function assertProjectAccess(projectId: string, user: ProjectUser) {
  const project = await dbFor(user.orgId).project.findFirst({
    where: { id: projectId, ...projectAccessWhere(user) },
  });
  if (!project) {
    throw new AppError("NOT_FOUND_001", "Project not found or access denied.");
  }
  return project;
}
