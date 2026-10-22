"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
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
import {
  Calendar,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Loader2,
  X,
} from "lucide-react";

export type FilterOption = { id: string; name: string };

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
  { value: "PROCESSING", label: "Processing" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
] as const;

export function InvoiceFilters({
  vendors,
  categories,
}: {
  vendors: FilterOption[];
  categories: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [vendorId, setVendorId] = useState(searchParams.get("vendorId") ?? "");
  const [categoryId, setCategoryId] = useState(
    searchParams.get("categoryId") ?? ""
  );
  const [status, setStatus] = useState(searchParams.get("status") ?? "ALL");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  // Count how many non-search filters are currently applied
  const activeFilterCount = [
    vendorId && vendorId !== "ALL",
    categoryId && categoryId !== "ALL",
    status && status !== "ALL",
    Boolean(from),
    Boolean(to),
  ].filter(Boolean).length;

  const hasAnyFilter = activeFilterCount > 0 || Boolean(q.trim());

  const apply = useCallback(
    (overrides?: Partial<Record<string, string>>) => {
      const params = new URLSearchParams();
      const next = {
        q,
        vendorId,
        categoryId,
        status,
        from,
        to,
        ...overrides,
      };
      if (next.q.trim()) params.set("q", next.q.trim());
      if (next.vendorId && next.vendorId !== "ALL") params.set("vendorId", next.vendorId);
      if (next.categoryId && next.categoryId !== "ALL") params.set("categoryId", next.categoryId);
      if (next.status && next.status !== "ALL") params.set("status", next.status);
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [q, vendorId, categoryId, status, from, to, pathname, router]
  );

  function clearAll() {
    setQ("");
    setVendorId("");
    setCategoryId("");
    setStatus("ALL");
    setFrom("");
    setTo("");
    startTransition(() => router.push(pathname));
  }

  // Quick preset helper for dates
  function applyDatePreset(type: "this_month" | "last_month" | "last_30_days" | "this_year") {
    const now = new Date();
    let newFrom = "";
    let newTo = "";

    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (type === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      newFrom = fmt(start);
      newTo = fmt(end);
    } else if (type === "last_month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      newFrom = fmt(start);
      newTo = fmt(end);
    } else if (type === "last_30_days") {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      newFrom = fmt(start);
      newTo = fmt(now);
    } else if (type === "this_year") {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31);
      newFrom = fmt(start);
      newTo = fmt(end);
    }

    setFrom(newFrom);
    setTo(newTo);
    apply({ from: newFrom, to: newTo });
  }

  const vendorItems = [
    { value: "ALL", label: "All vendors" },
    ...vendors.map((v) => ({ value: v.id, label: v.name })),
  ];
  const categoryItems = [
    { value: "ALL", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card/60 p-3.5 shadow-xs backdrop-blur-xs sm:p-4.5">
      {/* Top Bar: Search + Mobile Filter Button */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        {/* Search Input with Icon */}
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="invoice-q"
            placeholder="Search by invoice # or vendor name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            className="h-10 rounded-xl pl-9 pr-8 text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                apply({ q: "" });
              }}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Mobile Filter Toggle Button */}
          <Button
            type="button"
            variant={activeFilterCount > 0 ? "default" : "outline"}
            onClick={() => setIsMobileExpanded((prev) => !prev)}
            className="h-10 flex-1 gap-2 rounded-xl px-3.5 text-xs font-semibold sm:flex-initial"
          >
            <SlidersHorizontal className="size-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <Badge
                variant="secondary"
                className="size-5 rounded-full p-0 text-[10px] font-bold"
              >
                {activeFilterCount}
              </Badge>
            )}
            <ChevronDown
              className={`size-3.5 transition-transform duration-200 ${
                isMobileExpanded ? "rotate-180" : ""
              }`}
            />
          </Button>

          {/* Quick Apply Button on top for desktop */}
          <Button
            type="button"
            onClick={() => apply()}
            disabled={pending}
            className="h-10 rounded-xl px-4 text-xs font-semibold"
          >
            {pending ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Applying…
              </span>
            ) : (
              "Apply"
            )}
          </Button>

          {/* Clear Button if active */}
          {hasAnyFilter && (
            <Button
              type="button"
              variant="ghost"
              onClick={clearAll}
              disabled={pending}
              className="text-muted-foreground hover:text-foreground h-10 rounded-xl px-2.5 text-xs font-medium"
              title="Reset all filters"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* Expandable Filter Details Grid (Always visible on desktop md+, toggled on mobile) */}
      <div
        className={`${
          isMobileExpanded ? "grid" : "hidden md:grid"
        } gap-3 pt-2 border-t border-border/40 sm:gap-4`}
      >
        {/* Row 1: Dropdown Selects */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Vendor */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs font-medium">
              Vendor
            </Label>
            <Select
              value={vendorId || "ALL"}
              onValueChange={(value) => {
                const next = value === "ALL" || !value ? "" : value;
                setVendorId(next);
                apply({ vendorId: next });
              }}
              items={vendorItems}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-sm">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                {vendorItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs font-medium">
              Category
            </Label>
            <Select
              value={categoryId || "ALL"}
              onValueChange={(value) => {
                const next = value === "ALL" || !value ? "" : value;
                setCategoryId(next);
                apply({ categoryId: next });
              }}
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

          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs font-medium">
              Status
            </Label>
            <Select
              value={status || "ALL"}
              onValueChange={(value) => {
                const next = value ?? "ALL";
                setStatus(next);
                apply({ status: next });
              }}
              items={[...STATUS_OPTIONS]}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Row 2: Date Range & Controls with Pixel-Perfect Height Alignment */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          {/* Date From */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from" className="text-muted-foreground text-xs font-medium">
              Invoice Date From
            </Label>
            <DatePicker
              id="from"
              value={from}
              onChange={(val) => {
                setFrom(val);
                apply({ from: val });
              }}
              placeholder="From date"
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to" className="text-muted-foreground text-xs font-medium">
              Invoice Date To
            </Label>
            <DatePicker
              id="to"
              value={to}
              onChange={(val) => {
                setTo(val);
                apply({ to: val });
              }}
              placeholder="To date"
            />
          </div>

          {/* Date Presets */}
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
            <Label className="text-muted-foreground text-xs font-medium">
              Quick Date Presets
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyDatePreset("this_month")}
                className="h-10 rounded-xl px-3 text-xs font-medium"
              >
                This Month
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyDatePreset("last_month")}
                className="h-10 rounded-xl px-3 text-xs font-medium"
              >
                Last Month
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyDatePreset("last_30_days")}
                className="h-10 rounded-xl px-3 text-xs font-medium"
              >
                Last 30 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyDatePreset("this_year")}
                className="h-10 rounded-xl px-3 text-xs font-medium"
              >
                This Year
              </Button>
              {hasAnyFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="text-muted-foreground hover:text-destructive h-10 rounded-xl px-2.5 text-xs font-medium"
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

