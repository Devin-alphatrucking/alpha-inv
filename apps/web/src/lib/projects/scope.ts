import { cookies } from "next/headers";
import { seesAllProjects } from "@/lib/roles";
import { dbFor } from "@/lib/org/scoped-db";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";

export const PROJECT_SCOPE_COOKIE = "project-scope";

export async function getProjectScope(user: ProjectUser) {
  const projects = await dbFor(user.orgId).project.findMany({
    where: projectAccessWhere(user),
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, status: true },
  });

  const requested = (await cookies()).get(PROJECT_SCOPE_COOKIE)?.value;
  const selectedProjectId = projects.some((project) => project.id === requested)
    ? requested!
    : seesAllProjects(user.role)
      ? null
      : projects[0]?.id ?? null;

  return { projects, selectedProjectId };
}

