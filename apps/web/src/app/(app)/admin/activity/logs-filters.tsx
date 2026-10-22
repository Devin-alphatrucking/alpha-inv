"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string; count: number };

export function LogsFilters({
  filterOptions,
  filterLabel,
  filterParam,
  total,
  page,
  totalPages,
  currentFilter,
  currentQuery,
}: {
  filterOptions: FilterOption[];
  filterLabel: string;
  filterParam: string;
  total: number;
  page: number;
  totalPages: number;
  currentFilter: string;
  currentQuery: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(currentQuery);

  function apply(overrides: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Reset page on any filter change except explicit page navigation.
    if (!("page" in overrides)) params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const items = [
    { value: "ALL", label: `All ${filterLabel.toLowerCase()}`, count: total },
    ...filterOptions.map((o) => ({ value: o.value, label: o.label, count: o.count })),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card/60 p-3.5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            placeholder="Search action, entity, or user email…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply({ q: q.trim() || null });
            }}
            className="h-10 rounded-xl pl-9 pr-8 text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                apply({ q: null });
              }}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 sm:w-52 sm:flex-initial">
            <Select
              value={currentFilter || "ALL"}
              onValueChange={(value) =>
                apply({ [filterParam]: value === "ALL" || !value ? null : value })
              }
              items={items}
            >
              <SelectTrigger className="h-10 w-full rounded-xl text-sm">
                <SelectValue placeholder={`All ${filterLabel.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-10 rounded-xl px-3 text-xs"
            disabled={pending}
            onClick={() => apply({ q: q.trim() || null })}
          >
            Search
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-2">
        <Badge variant="secondary" className="text-xs">
          {total} record(s)
        </Badge>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={pending || page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={pending || page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
