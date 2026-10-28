import { hasPermission, seesAllProjects } from "@/lib/roles";
import { pageOrg } from "@/lib/org/page";
import type { Prisma } from "@alpha/db";
import { getProjectScope } from "@/lib/projects/scope";
import { canOpenPath } from "@/lib/roles";
import { loadModuleHub } from "@/lib/flows/hub";
import { ModuleHubView } from "@/components/module-hub";
import {
  DashboardView,
  type CategorySpendPoint,
  type MonthSpendPoint,
  type StatusPoint,
  type VendorSpendPoint,
  type ProjectSpendPoint,
  type RecentInvoice,
} from "@/components/dashboard-view";
import { getFormat } from "@/lib/brand/brand";
import { AttentionPanel } from "@/components/attention-panel";
import { loadAttention } from "@/lib/invoices/attention";
import { loadBudgetAlerts } from "@/lib/projects/budget-alerts";

/** Invoice dates are calendar dates stored at midnight UTC, so months are counted in UTC. Labels use mid-month noon so no time zone can shift them to the neighbouring month. */
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function buildMonthBuckets(anchorDate: Date, label: (d: Date) => string, count = 12): MonthSpendPoint[] {
  const points: MonthSpendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() - i, 15, 12));
    const key = monthKey(d);
    points.push({
      month: key,
      label: label(d),
      total: 0,
      paid: 0,
    });
  }
  return points;
}

type SearchParams = Promise<{
  categoryId?: string;
  from?: string;
  month?: string;
  to?: string;
}>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session, db, user } = await pageOrg();
  const fmt = await getFormat();

  const params = await searchParams;
  const selectedCategoryId = params.categoryId ?? "";
  const projectScope = await getProjectScope(user);
  const projectFilter: Prisma.InvoiceWhereInput = projectScope.selectedProjectId
    ? { projectId: projectScope.selectedProjectId }
    : !seesAllProjects(session.user.role)
      ? { projectId: { in: projectScope.projects.map((p) => p.id) } }
      : {};

  const hub = await loadModuleHub(user, projectScope.selectedProjectId);
  const attention = await loadAttention(db, projectFilter, fmt.format.timeZone);
  // Budgets are planning numbers: only roles with budget access see alerts, and only for the projects they can see.
  const budgetAlerts = hasPermission(session.user.role, "budget:view")
    ? await loadBudgetAlerts(db, projectScope.selectedProjectId ? { id: projectScope.selectedProjectId } : seesAllProjects(session.user.role) ? {} : { id: { in: projectScope.projects.map((p) => p.id) } })
    : [];

  const now = new Date();
  const defaultMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: fmt.format.timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const requestedMonth = params.month ?? "";
  const selectedMonth = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : defaultMonth;
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const selectedMonthStart = new Date(Date.UTC(selectedYear, selectedMonthNumber - 1, 1));
  const selectedMonthEnd = new Date(Date.UTC(selectedYear, selectedMonthNumber, 1));

  // Dates from the address bar: only YYYY-MM-DD is accepted, read as whole UTC days (how invoice and payment dates are stored).
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const parsedFrom = params.from && DATE_ONLY.test(params.from) ? new Date(`${params.from}T00:00:00.000Z`) : null;
  const parsedTo = params.to && DATE_ONLY.test(params.to) ? new Date(`${params.to}T23:59:59.999Z`) : null;
  const from: Date | undefined = parsedFrom && !isNaN(parsedFrom.getTime()) ? parsedFrom : undefined;
  const to: Date | undefined = parsedTo && !isNaN(parsedTo.getTime()) ? parsedTo : undefined;

  const confirmed: Prisma.InvoiceWhereInput = {
    status: { notIn: ["PROCESSING", "NEEDS_REVIEW"] },
  };
  const categoryFilter: Prisma.InvoiceWhereInput = selectedCategoryId
    ? { categoryId: selectedCategoryId }
    : {};
  const dateFilter: Prisma.InvoiceWhereInput = {};
  if (from || to) {
    dateFilter.invoiceDate = {};
    if (from) dateFilter.invoiceDate = { ...dateFilter.invoiceDate, gte: from };
    if (to) dateFilter.invoiceDate = { ...dateFilter.invoiceDate, lte: to };
  }
  // Streamlined fast queries: fetch report invoices with joins and categories in parallel
  const [allCategories, reportInvoices, projectsCount, monthlyBillCount] = await Promise.all([
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.invoice.findMany({
      where: { ...confirmed, ...projectFilter, ...categoryFilter, ...dateFilter },
      include: {
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        // All payments are loaded: "Paid" follows the selected dates, but what is still owed must count every payment ever made.
        payments: { select: { amount: true, paidOn: true } },
      },
      orderBy: { invoiceDate: "desc" },
    }),
    projectScope.selectedProjectId
      ? Promise.resolve(1)
      : !seesAllProjects(session.user.role)
        ? Promise.resolve(projectScope.projects.length)
        : db.project.count(),
    !seesAllProjects(session.user.role)
      ? db.invoice.count({
          where: {
            ...projectFilter,
            invoiceDate: { gte: selectedMonthStart, lt: selectedMonthEnd },
          },
        })
      : Promise.resolve(0),
  ]);

  let revenue = 0;
  let paid = 0;
  let unpaidCount = 0;
  let overdueCount = 0;
  let outstandingTotal = 0;
  const vendorSet = new Set<string>();
  const categoryMap = new Map<string, CategorySpendPoint>();
  const projectMap = new Map<string, ProjectSpendPoint>();
  const vendorMap = new Map<string, VendorSpendPoint>();
  const statusMap = new Map<string, StatusPoint>();

  const inRange = (p: { paidOn: Date }) => (!from || p.paidOn >= from) && (!to || p.paidOn <= to);

  for (const inv of reportInvoices) {
    const invTotal = Number(inv.total ?? 0);
    const invPaidAll = (inv.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const invPaid = (inv.payments ?? []).filter(inRange).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    revenue += invTotal;
    paid += invPaid;
    outstandingTotal += Math.max(0, invTotal - invPaidAll);

    if (inv.status === "UNPAID" || inv.status === "PARTIALLY_PAID") {
      unpaidCount++;
    } else if (inv.status === "OVERDUE") {
      overdueCount++;
    }

    const vendorDisplayName = inv.vendor?.name ?? "Unknown Vendor";
    vendorSet.add(inv.vendor?.id || vendorDisplayName);
    const vm = vendorMap.get(vendorDisplayName) ?? {
      name: vendorDisplayName,
      total: 0,
      count: 0,
    };
    vm.total += invTotal;
    vm.count++;
    vendorMap.set(vendorDisplayName, vm);

    const catKey = inv.categoryId ?? "UNCATEGORIZED";
    const catName = inv.category?.name ?? "Uncategorized";
    const cm = categoryMap.get(catKey) ?? {
      id: inv.categoryId,
      name: catName,
      total: 0,
      count: 0,
    };
    cm.total += invTotal;
    cm.count++;
    categoryMap.set(catKey, cm);

    const projKey = inv.projectId ?? "UNASSIGNED";
    const projName = inv.project?.name ?? "Unassigned";
    const pm = projectMap.get(projKey) ?? {
      id: inv.projectId,
      name: projName,
      total: 0,
      count: 0,
    };
    pm.total += invTotal;
    pm.count++;
    projectMap.set(projKey, pm);

    const statusLabel = (inv.status ?? "UNKNOWN").replaceAll("_", " ");
    const sm = statusMap.get(statusLabel) ?? {
      name: statusLabel,
      value: 0,
      count: 0,
    };
    sm.value += invTotal;
    sm.count++;
    statusMap.set(statusLabel, sm);
  }

  // Anchor date for Spend Trend:
  // If user provided a 'to' filter, use that.
  // Otherwise, if confirmed invoices exist and latest is > 6 months ago (e.g. 2024), anchor to that latest date!
  let anchorDate = now;
  if (to && !isNaN(to.getTime())) {
    anchorDate = to;
  } else if (reportInvoices.length > 0) {
    const latestInvoiceDate = reportInvoices[0]?.invoiceDate;
    if (latestInvoiceDate && !isNaN(latestInvoiceDate.getTime())) {
      if (now.getTime() - latestInvoiceDate.getTime() > 180 * 24 * 60 * 60 * 1000) {
        anchorDate = latestInvoiceDate;
      }
    }
  }

  const monthlySpend = buildMonthBuckets(anchorDate, (d) => fmt.monthYear(d), 12);
  const monthIndex = new Map(monthlySpend.map((p, i) => [p.month, i]));

  for (const inv of reportInvoices) {
    const d = inv.invoiceDate ? new Date(inv.invoiceDate) : null;
    if (!d || isNaN(d.getTime())) continue;
    const key = monthKey(d);
    const idx = monthIndex.get(key);
    if (idx != null) {
      monthlySpend[idx].total += Number(inv.total ?? 0);
      const invPaid = (inv.payments ?? []).filter(inRange).reduce((s, p) => s + Number(p.amount ?? 0), 0);
      monthlySpend[idx].paid += invPaid;
    }
  }

  const categorySpend = [...categoryMap.values()].sort((a, b) => b.total - a.total);
  const projectSpend = [...projectMap.values()].sort((a, b) => b.total - a.total);
  const statusBreakdown = [...statusMap.values()].sort((a, b) => b.value - a.value);
  const vendorSpend = [...vendorMap.values()].sort((a, b) => b.total - a.total).slice(0, 8);

  const recentInvoicesMapped: RecentInvoice[] = reportInvoices.slice(0, 8).map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? "",
    vendorName: inv.vendor?.name ?? "Unknown Vendor",
    total: Number(inv.total ?? 0),
    status: inv.status ?? "PROCESSING",
    invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString() : new Date().toISOString(),
  }));

  const pending = Math.max(0, outstandingTotal);
  const clientsCount = vendorSet.size;
  const selectedProject = projectScope.projects.find(
    (project) => project.id === projectScope.selectedProjectId
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selectedProject
            ? `${selectedProject.name} purchase invoices and spend.`
            : "Overview of construction purchase invoices and spend across all projects."}
        </p>
      </div>

      <ModuleHubView hub={hub} canOpen={(href) => canOpenPath(session.user.role, href)} />

      {[hub.accounts, hub.site, hub.purchase].filter(Boolean).length >= 2 && <h2 className="-mb-2 text-lg font-semibold tracking-tight">Accounts</h2>}

      <AttentionPanel summary={attention.summary} drafts={attention.drafts} money={(minor) => fmt.money(minor / 100, 2)} date={(d) => fmt.date(d)} budgets={budgetAlerts} />

      <DashboardView
        role={session.user.role}
        revenue={revenue}
        paid={paid}
        pending={pending}
        unpaidCount={unpaidCount}
        overdueCount={overdueCount}
        projectsCount={projectsCount}
        clientsCount={clientsCount}
        monthlyBillCount={monthlyBillCount}
        selectedMonth={selectedMonth}
        monthlySpend={monthlySpend}
        categorySpend={categorySpend}
        statusBreakdown={statusBreakdown}
        vendorSpend={vendorSpend}
        projectSpend={projectSpend}
        recentInvoices={recentInvoicesMapped}
        categories={allCategories}
        selectedCategoryId={selectedCategoryId}
        from={params.from ?? ""}
        to={params.to ?? ""}
      />
    </div>
  );
}
