import { dbFor } from "@/lib/org/scoped-db";
import { hasPermission } from "@/lib/roles";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { completionDate, openOrderRows, projectRows, sumProjects, supplierRows, type OrderFact, type OpenOrderRow, type ProjectRow, type ReportTotals, type SupplierRow } from "@/lib/purchase/report-rules";
import { isYmd } from "@/lib/site/rules";

/**
 * The purchase and project reports. Everything is limited to the projects the person can see, and budgets only appear for roles that may see budgets.
 * The project view is "to date" (committed, received, billed and paid over the life of the project); the supplier view follows the chosen period
 * (orders dated inside it); the open-orders list is today's position.
 */

export type ReportUser = ProjectUser;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const minor = (d: { toString(): string } | null | undefined) => (d ? Math.round(Number(d.toString()) * 100) : 0);
const milli = (d: { toString(): string }) => Math.round(Number(d.toString()) * 1000);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type Period = { from: string; to: string };

/** The period from the address bar, falling back to the last twelve months ending today. */
export function parsePeriod(raw: { from?: string | null; to?: string | null }, today: string): Period {
  const to = isYmd(raw.to) && raw.to <= today ? raw.to : today;
  const from = isYmd(raw.from) && raw.from <= to ? raw.from : addDays(to, -365);
  return { from, to };
}

export type PurchaseReport = {
  today: string;
  period: Period;
  projects: ProjectRow[];
  totals: ReportTotals;
  suppliers: SupplierRow[];
  open: OpenOrderRow[];
  showBudget: boolean;
};

export async function loadPurchaseReport(user: ReportUser, opts: { projectId?: string | null; from?: string | null; to?: string | null } = {}): Promise<PurchaseReport | null> {
  if (!hasPermission(user.role, "order:view")) return null;
  const db = dbFor(user.orgId);
  const today = todayIn(await companyTimeZone(user.orgId));
  const period = parsePeriod({ from: opts.from, to: opts.to }, today);
  const showBudget = hasPermission(user.role, "budget:view");

  const projectWhere = { ...projectAccessWhere(user), ...(opts.projectId ? { id: opts.projectId } : {}) };
  const projectList = await db.project.findMany({ where: projectWhere, orderBy: { name: "asc" }, select: { id: true, name: true, budget: true, status: true } });
  const ids = projectList.map((p) => p.id);
  if (ids.length === 0) return { today, period, projects: [], totals: sumProjects([]), suppliers: [], open: [], showBudget };

  const [allOrders, bills] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { projectId: { in: ids }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: {
        id: true, number: true, projectId: true, vendorId: true, status: true, orderDate: true, deliveryDate: true,
        project: { select: { name: true } }, vendor: { select: { name: true } },
        lines: { select: { id: true, quantity: true, rate: true, gstPercent: true } },
        receipts: { select: { receivedOn: true, lines: { select: { orderLineId: true, quantity: true, rejected: true } } } },
        invoices: { where: { status: { notIn: ["PROCESSING", "NEEDS_REVIEW"] } }, select: { total: true } },
      },
      take: 5000,
    }),
    db.invoice.findMany({
      where: { projectId: { in: ids }, status: { notIn: ["PROCESSING", "NEEDS_REVIEW"] } },
      select: { projectId: true, total: true, payments: { select: { amount: true } } },
      take: 50_000,
    }),
  ]);

  const facts: OrderFact[] = allOrders.map((o) => {
    const got: Record<string, number> = {};
    const refused: Record<string, number> = {};
    for (const r of o.receipts) for (const l of r.lines) {
      got[l.orderLineId] = (got[l.orderLineId] ?? 0) + milli(l.quantity);
      refused[l.orderLineId] = (refused[l.orderLineId] ?? 0) + milli(l.rejected);
    }
    const lines = o.lines.map((l) => ({ id: l.id, orderedMilli: milli(l.quantity), receivedMilli: got[l.id] ?? 0, rejectedMilli: refused[l.id] ?? 0, rateMinor: minor(l.rate), gstBps: Math.round(Number(l.gstPercent.toString()) * 100) }));
    return {
      id: o.id, number: o.number, projectId: o.projectId, projectName: o.project.name, vendorId: o.vendorId, vendorName: o.vendor.name,
      status: o.status as OrderFact["status"], orderDate: ymd(o.orderDate), deliveryDate: o.deliveryDate ? ymd(o.deliveryDate) : null,
      deliveredOn: completionDate(lines.map((l) => ({ id: l.id, orderedMilli: l.orderedMilli })), o.receipts.map((r) => ({ receivedOn: ymd(r.receivedOn), lines: r.lines.map((l) => ({ orderLineId: l.orderLineId, quantityMilli: milli(l.quantity) })) }))),
      lines, billedMinor: o.invoices.reduce((s, i) => s + minor(i.total), 0),
    };
  });

  const billed = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const b of bills) {
    billed.set(b.projectId, (billed.get(b.projectId) ?? 0) + minor(b.total));
    paid.set(b.projectId, (paid.get(b.projectId) ?? 0) + b.payments.reduce((s, p) => s + minor(p.amount), 0));
  }
  const projects = projectRows(facts, projectList.map((p) => ({ id: p.id, name: p.name, budgetMinor: showBudget && p.budget ? minor(p.budget) : null, billedAllMinor: billed.get(p.id) ?? 0, paidMinor: paid.get(p.id) ?? 0 })))
    // a project with no orders, no bills and no budget would only be a blank line
    .filter((r) => r.orders > 0 || r.billedAllMinor > 0 || r.budgetMinor !== null);

  const inPeriod = facts.filter((o) => o.orderDate >= period.from && o.orderDate <= period.to);
  return { today, period, projects, totals: sumProjects(projects), suppliers: supplierRows(inPeriod, today), open: openOrderRows(facts, today), showBudget };
}
