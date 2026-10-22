"use server";

import { pageOrg } from "@/lib/org/page";
import type { Prisma } from "@alpha/db";
import { getProjectScope } from "@/lib/projects/scope";
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

function buildMonthBuckets(anchorDate: Date, label: (d: Date) => string, count = 12): MonthSpendPoint[] {
  const points: MonthSpendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    : session.user.role === "STAFF"
      ? { projectId: { in: projectScope.projects.map((p) => p.id) } }
      : {};

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

  // Robust date parsing: prevent Invalid Date exceptions in Prisma
  let from: Date | undefined;
  if (params.from) {
    const parsed = new Date(params.from);
    if (!isNaN(parsed.getTime())) {
      from = parsed;
    }
  }

  let to: Date | undefined;
  if (params.to) {
    const parsed = new Date(params.to);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      to = parsed;
    }
  }

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
  const paymentDateFilter: Prisma.PaymentWhereInput = {};
  if (from || to) {
    paymentDateFilter.paidOn = {};
    if (from) paymentDateFilter.paidOn = { ...paymentDateFilter.paidOn, gte: from };
    if (to) paymentDateFilter.paidOn = { ...paymentDateFilter.paidOn, lte: to };
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
        payments: {
          select: { amount: true, paidOn: true },
          ...(from || to ? { where: paymentDateFilter } : {}),
        },
      },
      orderBy: { invoiceDate: "desc" },
    }),
    projectScope.selectedProjectId
      ? Promise.resolve(1)
      : session.user.role === "STAFF"
        ? Promise.resolve(projectScope.projects.length)
        : db.project.count(),
    session.user.role === "STAFF"
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

  for (const inv of reportInvoices) {
    const invTotal = Number(inv.total ?? 0);
    const invPaid = (inv.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    revenue += invTotal;
    paid += invPaid;
    const invBalance = Math.max(0, invTotal - invPaid);
    outstandingTotal += invBalance;

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
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx != null) {
      monthlySpend[idx].total += Number(inv.total ?? 0);
      const invPaid = (inv.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
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
