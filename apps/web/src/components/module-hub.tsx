import Link from "next/link";
import { ArrowRight, HardHat, Receipt, ShoppingCart } from "lucide-react";
import type { ModuleHub } from "@/lib/flows/hub";
import { cn } from "@/lib/utils";

type Stat = { label: string; value: number | null; warn?: boolean };

function ModuleCard({ href, title, blurb, icon: Icon, tone, stats, cta }: { href: string; title: string; blurb: string; icon: typeof Receipt; tone: string; stats: Stat[]; cta: string }) {
  const shown = stats.filter((s) => s.value !== null);
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-xs outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span aria-hidden className={cn("pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-[0.12] transition-transform duration-300 group-hover:scale-125", tone)} />
      <div className="flex items-center gap-3">
        <span className={cn("flex size-11 items-center justify-center rounded-xl text-white", tone)}><Icon className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{blurb}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {shown.map((s) => (
          <div key={s.label} className="rounded-xl bg-muted/50 px-3 py-2">
            <dd className={cn("text-2xl font-semibold tabular-nums", s.warn && s.value ? "text-destructive" : "")}>{s.value}</dd>
            <dt className="text-xs leading-tight text-muted-foreground">{s.label}</dt>
          </div>
        ))}
      </dl>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
        {cta}
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
      </span>
    </Link>
  );
}

const FLOW: { step: string; where: string; href: string; module: "site" | "purchase" | "accounts" }[] = [
  { step: "Site reports a need", where: "Request materials", href: "/purchase", module: "purchase" },
  { step: "Manager approves", where: "Approvals", href: "/purchase?status=SUBMITTED", module: "purchase" },
  { step: "Purchase orders", where: "Orders", href: "/purchase/orders", module: "purchase" },
  { step: "Goods arrive", where: "Delivery check", href: "/purchase/deliveries", module: "purchase" },
  { step: "Supplier bills", where: "Invoices", href: "/invoices", module: "accounts" },
  { step: "Checked and paid", where: "Payments", href: "/payments", module: "accounts" },
];

/** The three modules as large cards with live numbers, and the path a purchase takes through them. */
export function ModuleHubView({ hub, canOpen }: { hub: ModuleHub; canOpen: (href: string) => boolean }) {
  const cards = [
    hub.site && { key: "site", node: <ModuleCard key="site" href="/site" title="Site work" blurb="Daily reports, photos and issues from site" icon={HardHat} tone="bg-amber-500" cta="Open site work" stats={[{ label: "Reports today", value: hub.site.reportsToday }, { label: "Open issues", value: hub.site.openIssues }, { label: "Overdue", value: hub.site.overdueIssues, warn: true }]} /> },
    hub.purchase && { key: "purchase", node: <ModuleCard key="purchase" href="/purchase" title="Purchase" blurb="Requests, orders and deliveries" icon={ShoppingCart} tone="bg-sky-600" cta="Open purchase" stats={[{ label: "To approve", value: hub.purchase.waitingForApproval }, { label: "To order", value: hub.purchase.approvedToOrder }, { label: "Awaiting delivery", value: hub.purchase.awaitingDelivery }]} /> },
    hub.accounts && { key: "accounts", node: <ModuleCard key="accounts" href="/invoices" title="Accounts" blurb="Invoices, payments and GST" icon={Receipt} tone="bg-emerald-600" cta="Open accounts" stats={[{ label: "To review", value: hub.accounts.toReview }, { label: "Unpaid", value: hub.accounts.unpaid }, { label: "Overdue", value: hub.accounts.overdue, warn: true }]} /> },
  ].filter(Boolean) as { key: string; node: React.ReactNode }[];
  if (cards.length < 2) return null; // one module only (a staff member): the finance dashboard below is the whole story
  const flow = FLOW.filter((f) => canOpen(f.href.split("?")[0]));

  return (
    <section aria-label="Your modules" className="grid gap-4">
      <div className={cn("grid gap-4", cards.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3")}>{cards.map((c) => c.node)}</div>
      {flow.length > 2 && (
        <nav aria-label="How a purchase flows" className="rounded-2xl border bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">From site to payment</p>
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
            {flow.map((f, i) => (
              <li key={f.href} className="flex items-center gap-1">
                <Link href={f.href} className="rounded-lg px-2 py-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" title={f.where}>
                  <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}</span>{f.step}
                </Link>
                {i < flow.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
              </li>
            ))}
          </ol>
        </nav>
      )}
    </section>
  );
}
