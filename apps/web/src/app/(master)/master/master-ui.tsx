import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/billing/rules";
import type { PlanState } from "@/lib/plans/rules";

const dt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const d = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

/** Times in the console are UTC, so two operators in different places read the same thing. */
export const fmtDateTime = (v: Date | null | undefined) => (v ? `${dt.format(v)} UTC` : "-");
export const fmtDate = (v: Date | null | undefined) => (v ? d.format(v) : "-");
export const money = (minor: number, currency: string) => formatMoney(minor, currency);

export const STATE_LABEL: Record<PlanState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  trial: { label: "Trial", variant: "secondary" },
  past_due_grace: { label: "Overdue (grace)", variant: "destructive" },
  past_due: { label: "Overdue", variant: "destructive" },
  canceling: { label: "Ends soon", variant: "outline" },
  canceled: { label: "Cancelled", variant: "outline" },
  trial_expired: { label: "Trial ended", variant: "destructive" },
  none: { label: "No plan", variant: "outline" },
};

export function StateBadge({ state }: { state: PlanState }) {
  const s = STATE_LABEL[state];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function CompanyStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "SUSPENDED" || status === "CLOSED" ? "destructive" : "outline"}>{status}</Badge>;
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "warn" | "bad" }) {
  const body = (
    <Card className={href ? "transition-colors hover:bg-muted/40" : undefined}>
      <CardContent className="grid gap-1 p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Previous / next links that keep the other filters in the address. */
export function Pager({ basePath, params, page, total, pageSize }: { basePath: string; params: Record<string, string | undefined>; page: number; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  if (pages <= 1) return <p className="text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</p>;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {total} results, page {page} of {pages}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} render={page > 1 ? <Link href={href(page - 1)} /> : undefined} nativeButton={page <= 1}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} render={page < pages ? <Link href={href(page + 1)} /> : undefined} nativeButton={page >= pages}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** A plain GET form: filters live in the address, so a view can be bookmarked or shared. */
export function FilterBar({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3">
      {children}
      <Button type="submit" size="sm">
        Filter
      </Button>
    </form>
  );
}
