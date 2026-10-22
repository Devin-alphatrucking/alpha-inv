"use client";

import * as React from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormat } from "@/components/format-provider";

export interface DatePickerProps {
  value?: string; // "YYYY-MM-DD"
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseDate(str?: string): Date | null {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  className,
  id,
  disabled = false,
}: DatePickerProps) {
  const locale = useFormat().format.locale;
  const [open, setOpen] = React.useState(false);
  const selectedDate = React.useMemo(() => parseDate(value), [value]);

  // View state: current month/year being viewed in calendar
  const [viewDate, setViewDate] = React.useState(() => {
    return selectedDate ?? new Date();
  });

  // When selected date changes from outside, sync viewDate
  React.useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate);
    }
  }, [value]);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  // Navigation handlers
  function prevMonth() {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
  }

  function nextMonth() {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
  }

  function handleSelectDate(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    onChange(formatDate(d));
    setOpen(false);
  }

  function handleToday() {
    const today = new Date();
    onChange(formatDate(today));
    setViewDate(today);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    onChange("");
  }

  // Generate days matrix
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === viewYear && today.getMonth() === viewMonth;
  const isSelectedMonth =
    selectedDate &&
    selectedDate.getFullYear() === viewYear &&
    selectedDate.getMonth() === viewMonth;

  // Year options for quick select dropdown (e.g. from 2020 to 2030)
  const currentYear = new Date().getFullYear();
  const yearOptions = React.useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 5; y <= currentYear + 3; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Formatted display label for trigger button
  const displayLabel = selectedDate
    ? selectedDate.toLocaleDateString(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id}
            disabled={disabled}
            className={cn(
              "group relative flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background/90 px-3 text-left text-sm shadow-xs transition-all outline-none",
              "hover:border-foreground/30 hover:bg-background",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
              "disabled:cursor-not-allowed disabled:opacity-50",
              !selectedDate && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <span className="flex items-center gap-2 truncate">
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          <span className="truncate">{displayLabel || placeholder}</span>
        </span>

        {selectedDate && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => e.key === "Enter" && handleClear(e as any)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Clear date"
          >
            <X className="size-3" />
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[280px] p-3 shadow-2xl backdrop-blur-md"
      >
        {/* Header: Month & Year Selector + Prev/Next Buttons */}
        <div className="flex items-center justify-between gap-1 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <select
              value={viewMonth}
              onChange={(e) =>
                setViewDate(new Date(viewYear, Number(e.target.value), 1))
              }
              className="cursor-pointer rounded-lg border-0 bg-transparent px-1.5 py-1 text-sm font-semibold hover:bg-muted/80 focus:ring-1 focus:ring-ring outline-none"
            >
              {MONTH_NAMES.map((name, idx) => (
                <SelectItemMonth key={name} value={idx} label={name} />
              ))}
            </select>
            <select
              value={viewYear}
              onChange={(e) =>
                setViewDate(new Date(Number(e.target.value), viewMonth, 1))
              }
              className="cursor-pointer rounded-lg border-0 bg-transparent px-1.5 py-1 text-sm font-semibold hover:bg-muted/80 focus:ring-1 focus:ring-ring outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y} className="bg-popover text-popover-foreground">
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={prevMonth}
              className="size-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={nextMonth}
              className="size-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Weekday Labels */}
        <div className="grid grid-cols-7 gap-1 pb-1 text-center">
          {WEEKDAY_NAMES.map((w) => (
            <div
              key={w}
              className="text-[11px] font-medium text-muted-foreground/70"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Previous month trailing days */}
          {Array.from({ length: firstDayWeekday }).map((_, i) => {
            const dayNum = daysInPrevMonth - firstDayWeekday + i + 1;
            return (
              <button
                key={`prev-${dayNum}`}
                type="button"
                onClick={() => {
                  setViewDate(new Date(viewYear, viewMonth - 1, dayNum));
                  const d = new Date(viewYear, viewMonth - 1, dayNum);
                  onChange(formatDate(d));
                  setOpen(false);
                }}
                className="flex size-8 items-center justify-center rounded-lg text-xs text-muted-foreground/35 hover:bg-muted/40 transition-colors"
              >
                {dayNum}
              </button>
            );
          })}

          {/* Current month days */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const isSelected = isSelectedMonth && selectedDate.getDate() === dayNum;
            const isToday = isCurrentMonth && today.getDate() === dayNum;

            return (
              <button
                key={`day-${dayNum}`}
                type="button"
                onClick={() => handleSelectDate(dayNum)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition-all duration-150",
                  isSelected
                    ? "bg-foreground text-background font-bold shadow-xs hover:bg-foreground/90"
                    : "text-foreground hover:bg-muted",
                  isToday && !isSelected && "ring-1.5 ring-primary/60 font-semibold"
                )}
              >
                {dayNum}
              </button>
            );
          })}
        </div>

        {/* Footer: Today & Clear Quick Actions */}
        <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToday}
            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Today
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-destructive"
            >
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectItemMonth({ value, label }: { value: number; label: string }) {
  return (
    <option value={value} className="bg-popover text-popover-foreground">
      {label}
    </option>
  );
}
