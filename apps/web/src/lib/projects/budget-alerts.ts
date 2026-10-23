import type { Prisma } from "@alpha/db";
import type { ScopedDb } from "@/lib/org/scoped-db";
import { budgetAlerts, type BudgetAlert } from "./budget";

/** What each project has spent: the total of its CONFIRMED invoices (drafts waiting for review are not counted yet). */
export async function projectSpend(db: ScopedDb, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db.invoice.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds }, status: { notIn: ["NEEDS_REVIEW", "PROCESSING"] } },
    _sum: { total: true },
  });
  return new Map(rows.map((r) => [r.projectId, Number(r._sum.total ?? 0)]));
}

/** Active projects that have reached 80% of their budget (over-budget ones first). `where` limits which projects are considered. */
export async function loadBudgetAlerts(db: ScopedDb, where: Prisma.ProjectWhereInput = {}): Promise<BudgetAlert[]> {
  const projects = await db.project.findMany({
    where: { ...where, status: "ACTIVE", budget: { not: null } },
    select: { id: true, name: true, budget: true },
  });
  const spent = await projectSpend(db, projects.map((p) => p.id));
  return budgetAlerts(projects.map((p) => ({ id: p.id, name: p.name, spent: spent.get(p.id) ?? 0, budget: p.budget ? Number(p.budget) : null })));
}
