import { budgetStatus } from "@/lib/projects/budget";

const TONE = {
  ok: { bar: "bg-emerald-500", text: "text-muted-foreground" },
  warn: { bar: "bg-amber-500", text: "text-amber-600" },
  over: { bar: "bg-red-500", text: "text-red-600" },
} as const;

/** "₹4,10,000 of ₹5,00,000 (82%)" with a bar: green under 80%, amber from 80%, red at 100% and over. Shows nothing for a project with no budget. */
export function BudgetMeter({ spent, budget, money, compact }: { spent: number; budget: number | null | undefined; money: (n: number) => string; compact?: boolean }) {
  const s = budgetStatus(spent, budget);
  if (s.level === "none" || s.percent === null || s.budgetMinor === null) {
    return compact ? <span className="text-xs text-muted-foreground">No budget</span> : null;
  }
  const tone = TONE[s.level];
  const width = Math.min(100, s.percent);
  const note = s.level === "over" ? `${money(s.overMinor / 100)} over budget` : `${money((s.remainingMinor ?? 0) / 100)} left`;
  return (
    <div className="grid gap-1" aria-label="Budget">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums">
          {money(s.spentMinor / 100)} <span className="text-muted-foreground">of {money(s.budgetMinor / 100)}</span>
        </span>
        <span className={`font-semibold tabular-nums ${tone.text}`}>{Math.round(s.percent)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(s.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
      <p className={`text-xs ${tone.text}`}>{note}</p>
    </div>
  );
}
