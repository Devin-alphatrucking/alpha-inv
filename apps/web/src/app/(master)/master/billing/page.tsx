import Link from "next/link";
import { billingOverview } from "@/lib/master/queries";
import { razorpayConfig } from "@/lib/billing/razorpay";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle, StateBadge, fmtDate, fmtDateTime, money } from "../master-ui";
import { ReconcileButton } from "../master-client";

export const metadata = { title: "Billing | Master console" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const b = await billingOverview();
  const cfg = razorpayConfig();

  return (
    <>
      <PageTitle title="Billing">Companies that need attention, recent payments and what Razorpay has been telling us.</PageTitle>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment service</CardTitle>
          <CardDescription>
            {cfg ? `Razorpay is connected (${cfg.keyId.startsWith("rzp_live") ? "live" : "test"} keys). Webhook secret ${cfg.webhookSecret ? "is set" : "is NOT set: webhooks are refused"}.` : "Razorpay keys are not set: customers are asked to contact support to add a project plan."}
            {b.errorEvents > 0 ? ` ${b.errorEvents} webhook event${b.errorEvents === 1 ? "" : "s"} failed to process.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>{cfg && <ReconcileButton label="Re-check every unfinished purchase" />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Needs attention ({b.watch.length})</CardTitle>
          <CardDescription>Overdue, ending, cancelled or trial ended.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {b.watch.length === 0 && <p className="text-muted-foreground">Nothing needs attention.</p>}
          {b.watch.map((c) => (
            <Link key={c.id} href={`/master/companies/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted/40">
              <span className="font-medium">{c.name}</span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{c.state === "past_due_grace" ? `grace ends ${fmtDate(c.graceEndsAt)}` : c.currentPeriodEnd ? `period ${fmtDate(c.currentPeriodEnd)}` : ""}</span>
                <StateBadge state={c.state} />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent payments</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {b.payments.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
            {b.payments.map((p) => (
              <p key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <Link href={`/master/companies/${p.purchase.organization.id}`} className="underline-offset-4 hover:underline">
                    {p.purchase.organization.name}
                  </Link>{" "}
                  <span className="text-xs text-muted-foreground">{fmtDateTime(p.paidAt)}</span>
                </span>
                <span className="shrink-0 font-medium">{money(p.amountMinor, p.currency)}</span>
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Razorpay messages</CardTitle>
            <CardDescription>The 30 most recent webhook events.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-xs">
            {b.events.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            {b.events.map((ev) => (
              <p key={ev.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="font-mono font-semibold">{ev.type}</span>{" "}
                  <span className="text-muted-foreground">{fmtDateTime(ev.receivedAt)}</span>
                  {ev.error && <span className="text-red-600"> · {ev.error}</span>}
                </span>
                <Badge variant={ev.outcome === "error" ? "destructive" : ev.outcome === "processed" ? "default" : "outline"}>{ev.outcome ?? "pending"}</Badge>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
