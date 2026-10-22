import { cn } from "@/lib/utils";

/** "Projects 1 of 1" with a bar. Turns amber near or at the limit and red only when over it. */
export function UsageMeter({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  hint?: string;
}) {
  const pct = limit <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit;
  const tone = over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm tabular-nums text-muted-foreground">
          <span className={cn("font-semibold", over ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-foreground")}>{used}</span> of {limit}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={label}>
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
