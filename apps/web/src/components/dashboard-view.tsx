"use client";

import { seesAllProjects, type RoleName } from "@/lib/roles";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Banknote,
  Building2,
  Clock,
  FileText,
  FolderKanban,
  Receipt,
  SlidersHorizontal,
  ChevronDown,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormat } from "@/components/format-provider";
import { todayIn } from "@/lib/invoices/status";

export type MonthSpendPoint = {
  month: string;
  label: string;
  total: number;
  paid: number;
};

export type CategorySpendPoint = {
  id: string | null;
  name: string;
  total: number;
  count: number;
};

export type StatusPoint = { name: string; value: number; count: number };
export type VendorSpendPoint = { name: string; total: number; count: number };
export type ProjectSpendPoint = { id: string | null; name: string; total: number; count: number };
export type CategoryOption = { id: string; name: string };

export type RecentInvoice = {
  id: string;
  invoiceNumber: string;
  vendorName: string;
  total: number;
  status: string;
  invoiceDate: string;
};

const CHART_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCESSING: "outline",
  NEEDS_REVIEW: "secondary",
  UNPAID: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

/** Calendar-date helpers in the COMPANY's time zone (not the browser's, not UTC), as YYYY-MM-DD. */
function todayInput(timeZone: string, offsetDays = 0) {
  const [y, m, d] = todayIn(timeZone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - offsetDays)).toISOString().slice(0, 10);
}

/** First and last day of the month that is `monthsBack` months before the current one. */
function monthRange(timeZone: string, monthsBack: number) {
  const [y, m] = todayIn(timeZone).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const end = new Date(Date.UTC(y, m - monthsBack, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function DashboardView({
  role,
  revenue,
  paid,
  pending,
  unpaidCount,
  overdueCount,
  projectsCount,
  clientsCount,
  monthlyBillCount,
  selectedMonth,
  monthlySpend,
  categorySpend,
  statusBreakdown,
  vendorSpend,
  projectSpend,
  recentInvoices,
  categories,
  selectedCategoryId,
  from,
  to,
}: {
  role: RoleName;
  revenue: number;
  paid: number;
  pending: number;
  unpaidCount: number;
  overdueCount: number;
  projectsCount: number;
  clientsCount: number;
  monthlyBillCount: number;
  selectedMonth: string;
  monthlySpend: MonthSpendPoint[];
  categorySpend: CategorySpendPoint[];
  statusBreakdown: StatusPoint[];
  vendorSpend: VendorSpendPoint[];
  projectSpend: ProjectSpendPoint[];
  recentInvoices: RecentInvoice[];
  categories: CategoryOption[];
  selectedCategoryId: string;
  from: string;
  to: string;
}) {
  const fmt = useFormat();
  const formatInr = (value: number, maxFraction = 0) => fmt.money(value, maxFraction);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingTransition, startTransition] = useTransition();
  const [tab, setTab] = useState("overview");
  const [fromVal, setFromVal] = useState(from);
  const [toVal, setToVal] = useState(to);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function applyFilters(overrides?: { from?: string; to?: string; categoryId?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const next = {
      from: overrides?.from !== undefined ? overrides.from : fromVal,
      to: overrides?.to !== undefined ? overrides.to : toVal,
      categoryId:
        overrides?.categoryId !== undefined
          ? overrides.categoryId
          : selectedCategoryId,
    };
    if (next.from) params.set("from", next.from);
    else params.delete("from");
    if (next.to) params.set("to", next.to);
    else params.delete("to");
    if (next.categoryId) params.set("categoryId", next.categoryId);
    else params.delete("categoryId");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function applyMonth(month: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (month) params.set("month", month);
    else params.delete("month");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const timeZone = fmt.format.timeZone;

  function applyRange(fromDate: string, toDate: string) {
    setFromVal(fromDate);
    setToVal(toDate);
    applyFilters({ from: fromDate, to: toDate });
  }

  function applyPreset(days: number) {
    applyRange(todayInput(timeZone, days), todayInput(timeZone));
  }

  function applyThisMonth() {
    const r = monthRange(timeZone, 0);
    applyRange(r.from, r.to);
  }

  function applyLastMonth() {
    const r = monthRange(timeZone, 1);
    applyRange(r.from, r.to);
  }

  function clearDates() {
    setFromVal("");
    setToVal("");
    applyFilters({ from: "", to: "" });
  }

  const categoryItems = useMemo(
    () => [
      { value: "ALL", label: "All categories" },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories]
  );

  const hasMonthData = monthlySpend.some((p) => p.total > 0);
  const hasCategoryData = categorySpend.length > 0;
  const hasProjectData = projectSpend.length > 0;
  const activeFilterCount = [fromVal, toVal, selectedCategoryId].filter(Boolean).length;

  const kpis = [
    { label: "Revenue", value: formatInr(revenue), icon: Receipt, tone: "text-foreground" },
    { label: "Paid", value: formatInr(paid), icon: Banknote, tone: "text-emerald-600" },
    { label: "Pending", value: formatInr(pending), icon: Clock, tone: "text-amber-600" },
    { label: "Overdue", value: String(overdueCount), icon: TrendingUp, tone: "text-destructive" },
    { label: "Projects", value: String(projectsCount), icon: FolderKanban, tone: "text-foreground" },
    { label: "Clients", value: String(clientsCount), icon: Building2, tone: "text-foreground" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!seesAllProjects(role) && (
        <div className="flex items-end justify-between gap-4 rounded-xl border bg-card/60 p-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-56">
            <Label htmlFor="staff-dashboard-month" className="text-xs text-muted-foreground">
              Bill month
            </Label>
            <Input
              id="staff-dashboard-month"
              type="month"
              value={selectedMonth}
              min="1000-01"
              max="9999-12"
              className="h-10 rounded-xl bg-background"
              disabled={pendingTransition}
              onChange={(event) => applyMonth(event.target.value)}
            />
          </div>
          <div className="shrink-0 text-right" aria-live="polite">
            <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" />
              Total bills
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {pendingTransition ? <Loader2 className="ml-auto size-5 animate-spin" /> : monthlyBillCount}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3.5">
        <button
          type="button"
          className="flex h-10 items-center justify-between gap-3 text-sm font-medium md:hidden"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="min-w-5 justify-center px-1.5">
                {activeFilterCount}
              </Badge>
            )}
          </span>
          <ChevronDown className={`size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
        </button>
        <div className={`${filtersOpen ? "grid" : "hidden"} gap-3 border-t pt-3 sm:grid-cols-2 md:grid md:border-0 md:pt-0 lg:grid-cols-3 lg:items-end`}>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <DatePicker
              value={fromVal}
              onChange={setFromVal}
              placeholder="From date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <DatePicker
              value={toVal}
              onChange={setToVal}
              placeholder="To date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select
              value={selectedCategoryId || "ALL"}
              onValueChange={(value) =>
                applyFilters({ categoryId: value === "ALL" || !value ? "" : value })
              }
              items={categoryItems}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-sm">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                {categoryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button
              type="button"
              size="sm"
              className="h-10 rounded-xl px-3.5 text-xs font-semibold"
              disabled={pendingTransition}
              onClick={() => applyFilters()}
            >
              {pendingTransition ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Applying…
                </span>
              ) : (
                "Apply"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 rounded-xl px-3 text-xs"
              onClick={applyThisMonth}
            >
              This Month
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 rounded-xl px-3 text-xs"
              onClick={applyLastMonth}
            >
              Last Month
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 rounded-xl px-3 text-xs"
              onClick={() => applyPreset(30)}
            >
              30 days
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 rounded-xl px-3 text-xs"
              onClick={() => applyPreset(365)}
            >
              12 months
            </Button>
            {(fromVal || toVal) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-10 rounded-xl px-2.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearDates}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 min-[1400px]:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="min-w-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm">
              <CardHeader className="gap-1 p-3 sm:p-4">
                <CardDescription className="flex items-center gap-1.5">
                  <Icon className="size-3.5" />
                  {kpi.label}
                </CardDescription>
                <CardTitle className={`truncate text-lg tabular-nums sm:text-xl ${kpi.tone}`}>{kpi.value}</CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v ?? "overview")}>
        <TabsList className="w-full max-w-full justify-start overflow-x-auto overflow-y-hidden sm:w-fit">
          <TabsTrigger value="overview" className="shrink-0">Overview</TabsTrigger>
          <TabsTrigger value="invoices" className="shrink-0">Invoices</TabsTrigger>
          <TabsTrigger value="revenue" className="shrink-0">Revenue</TabsTrigger>
          <TabsTrigger value="projects" className="shrink-0">Projects</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spend trend</CardTitle>
                <CardDescription>Month-wise invoiced total (last 12 months)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {!hasMonthData ? (
                  <ChartEmpty message="No invoice totals yet. Upload and confirm invoices to see the trend." />
                ) : (
                  <div className="h-[220px] w-full min-w-0 sm:h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlySpend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tickMargin={8} />
                        <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                        <Tooltip formatter={(value) => [formatInr(Number(value ?? 0)), "Spend"]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
                        <Area type="monotone" dataKey="total" stroke="var(--foreground)" strokeWidth={2} fill="url(#spendFill)" dot={{ r: 3, fill: "var(--foreground)" }} activeDot={{ r: 5 }} animationDuration={500} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By category</CardTitle>
                <CardDescription>Spend breakdown across material categories</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {!hasCategoryData ? (
                  <ChartEmpty message="No categorized invoices yet." />
                ) : (
                  <div className="h-[260px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categorySpend} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                        <YAxis type="category" dataKey="name" width={88} tickLine={false} axisLine={false} fontSize={11} />
                        <Tooltip formatter={(value, _name, item) => [formatInr(Number(value ?? 0)), `${(item?.payload as CategorySpendPoint | undefined)?.count ?? 0} invoice(s)`]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
                        <Bar dataKey="total" fill="var(--foreground)" radius={[0, 6, 6, 0]} animationDuration={700} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invoice status</CardTitle>
                <CardDescription>Value split by payment status</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {statusBreakdown.length === 0 ? (
                  <ChartEmpty message="No confirmed invoices to summarize." />
                ) : (
                  <div className="h-[260px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2}>
                          {statusBreakdown.map((row, index) => <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value, _name, item) => [formatInr(Number(value ?? 0)), `${(item?.payload as StatusPoint | undefined)?.count ?? 0} invoice(s)`]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top vendors</CardTitle>
                <CardDescription>Invoice value by supplier</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {vendorSpend.length === 0 ? (
                  <ChartEmpty message="No vendor spend available yet." />
                ) : (
                  <div className="h-[260px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={vendorSpend} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                        <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} fontSize={11} />
                        <Tooltip formatter={(value, _name, item) => [formatInr(Number(value ?? 0)), `${(item?.payload as VendorSpendPoint | undefined)?.count ?? 0} invoice(s)`]} />
                        <Bar dataKey="total" fill="#2563eb" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Confirmed invoices by status</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {statusBreakdown.length === 0 ? (
                  <ChartEmpty message="No confirmed invoices yet." />
                ) : (
                  <div className="h-[260px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                          {statusBreakdown.map((row, index) => <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value, _name, item) => [formatInr(Number(value ?? 0)), `${(item?.payload as StatusPoint | undefined)?.count ?? 0} invoice(s)`]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent invoices</CardTitle>
                <CardDescription>Latest confirmed invoices</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {recentInvoices.length === 0 ? (
                  <ChartEmpty message="No invoices yet." />
                ) : (
                  <div className="divide-y">
                    {recentInvoices.map((invoice) => (
                      <Link
                        key={invoice.id}
                        href={`/invoices/${invoice.id}/review`}
                        className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{invoice.invoiceNumber}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {invoice.vendorName} · {fmt.date(invoice.invoiceDate)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={STATUS_VARIANT[invoice.status] ?? "outline"}>
                            {invoice.status.replace("_", " ")}
                          </Badge>
                          <span className="tabular-nums font-medium">{formatInr(invoice.total)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="revenue" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Revenue vs paid</CardTitle>
                <CardDescription>Invoiced vs collected per month</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {!hasMonthData ? (
                  <ChartEmpty message="No revenue data yet." />
                ) : (
                  <div className="h-[300px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlySpend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tickMargin={8} />
                        <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                        <Tooltip formatter={(value, name) => [formatInr(Number(value ?? 0)), name === "total" ? "Invoiced" : "Paid"]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area type="monotone" dataKey="total" name="Invoiced" stroke="#2563eb" fill="#2563eb22" strokeWidth={2} animationDuration={700} />
                        <Area type="monotone" dataKey="paid" name="Paid" stroke="#16a34a" fill="#16a34a22" strokeWidth={2} animationDuration={700} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid content-start gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total revenue</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{formatInr(revenue)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total collected</CardDescription>
                  <CardTitle className="text-2xl tabular-nums text-emerald-600">{formatInr(paid)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Outstanding</CardDescription>
                  <CardTitle className="text-2xl tabular-nums text-amber-600">{formatInr(pending)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Unpaid / overdue invoices</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {unpaidCount} unpaid · {overdueCount} overdue
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Spend by project</CardTitle>
              <CardDescription>Invoice value per project/site</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {!hasProjectData ? (
                <ChartEmpty message="No project spend yet." />
              ) : (
                <div className="h-[320px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectSpend} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                      <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip formatter={(value, _name, item) => [formatInr(Number(value ?? 0)), `${(item?.payload as ProjectSpendPoint | undefined)?.count ?? 0} invoice(s)`]} />
                      <Bar dataKey="total" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
