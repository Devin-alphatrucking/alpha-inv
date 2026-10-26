import { dbFor } from "@/lib/org/scoped-db";
import { hasPermission } from "@/lib/roles";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import type { ProjectUser } from "@/lib/projects/access";
import { listDeliveries } from "@/lib/flows/delivery";
import { purchaseOverview } from "@/lib/flows/purchase";
import { siteOverview } from "@/lib/flows/site";

/** The numbers on the three module cards of the dashboard. A module a person's role cannot open is `null`: no card, no numbers. */
export type ModuleHub = {
  accounts: { toReview: number; overdue: number; unpaid: number } | null;
  site: { projects: number; reportsToday: number; openIssues: number; overdueIssues: number } | null;
  purchase: { waitingForApproval: number; approvedToOrder: number; awaitingDelivery: number | null } | null;
};

export async function loadModuleHub(user: ProjectUser, projectId: string | null): Promise<ModuleHub> {
  const db = dbFor(user.orgId);
  const scope = projectId ? { projectId } : {};

  const accounts = hasPermission(user.role, "invoice:view")
    ? await (async () => {
        const where = { ...invoiceAccessWhere(user), ...scope };
        const [toReview, overdue, unpaid] = await Promise.all([
          db.invoice.count({ where: { ...where, status: "NEEDS_REVIEW" } }),
          db.invoice.count({ where: { ...where, status: "OVERDUE" } }),
          db.invoice.count({ where: { ...where, status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] } } }),
        ]);
        return { toReview, overdue, unpaid };
      })()
    : null;

  const site = hasPermission(user.role, "site:view")
    ? await (async () => {
        const o = await siteOverview(user);
        const projects = projectId ? o.projects.filter((p) => p.id === projectId) : o.projects;
        return {
          projects: projects.length,
          reportsToday: projects.filter((p) => p.todayReport !== null).length,
          openIssues: projects.reduce((s, p) => s + p.openIssues, 0),
          overdueIssues: projects.reduce((s, p) => s + p.overdueIssues, 0),
        };
      })()
    : null;

  const purchase = hasPermission(user.role, "request:view")
    ? await (async () => {
        const [o, deliveries] = await Promise.all([purchaseOverview(user), hasPermission(user.role, "delivery:view") ? listDeliveries(user) : Promise.resolve(null)]);
        return { waitingForApproval: o.waitingForApproval, approvedToOrder: o.approvedToOrder, awaitingDelivery: deliveries ? deliveries.length : null };
      })()
    : null;

  return { accounts, site, purchase };
}
