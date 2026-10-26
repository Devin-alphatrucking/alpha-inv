import { hasPermission } from "@/lib/roles";
import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { projectAccessWhere } from "@/lib/projects/access";
import { projectSpend } from "@/lib/projects/budget-alerts";

export const runtime = "nodejs";

/** The projects this person may use (everything for an administrator, assigned ones for staff). */
export const GET = route("/api/v1/projects", async (req) => {
  const me = await requireMobile(req);
  const db = dbFor(me.orgId);
  const canSeeBudget = hasPermission(me.role, "budget:view");
  const found = await db.project.findMany({
    where: { ...projectAccessWhere(me), status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, monthlyPageLimit: true, budget: true },
  });
  // Budgets are the administrators' planning numbers: staff get null.
  const spend = canSeeBudget ? await projectSpend(db, found.map((p) => p.id)) : new Map<string, number>();
  const projects = found.map(({ budget, ...p }) => ({
    ...p,
    budget: canSeeBudget && budget ? Number(budget) : null,
    spent: canSeeBudget ? (spend.get(p.id) ?? 0) : null,
  }));
  return json({ projects });
});
