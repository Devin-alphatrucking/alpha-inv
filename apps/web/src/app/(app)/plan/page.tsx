import { homeFor } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import { getBrand, getFormat } from "@/lib/brand/brand";
import { getBillingSummary } from "@/lib/billing/service";
import { formatMoney } from "@/lib/billing/rules";
import { getEntitlements } from "@/lib/plans/entitlements";
import { blockedMessage } from "@/lib/plans/rules";
import { getUsageSummary } from "@/lib/usage/pages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMeter } from "@/components/usage-meter";
import { BuyButton, CancelPlanButton } from "./billing-controls";

export const metadata = { title: "Plan & usage" };

const STATE_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trial: { label: "Free trial", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  past_due_grace: { label: "Payment overdue (grace period)", variant: "destructive" },
  past_due: { label: "Payment overdue", variant: "destructive" },
  canceling: { label: "Ends soon", variant: "secondary" },
  canceled: { label: "Ended", variant: "destructive" },
  trial_expired: { label: "Trial ended", variant: "destructive" },
  none: { label: "No plan", variant: "destructive" },
};

export default async function PlanPage() {
  const { session, db, orgId } = await pageOrg({ allowLocked: true });
  if (session.user.role !== "ADMIN") redirect(homeFor(session.user.role));

  const fmt = await getFormat();
  const brand = await getBrand();
  const e = await getEntitlements(orgId);
  const billing = await getBillingSummary(orgId);
  const projects = await db.project.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, monthlyPageLimit: true } });
  const usage = await getUsageSummary(orgId, projects.map((p) => p.id));
  const status = STATE_LABEL[e.state] ?? STATE_LABEL.none;
  const blocked = blockedMessage(e.state);
  const askMore = "/support?topic=add-project";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan &amp; usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">What your plan includes and how much of it you are using.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{e.planName ?? "No plan"}</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <CardDescription>
            {e.hasSubscription
              ? `You have ${e.quantity} project plan${e.quantity === 1 ? "" : "s"}. Each plan includes 1 project, its own users and AI pages.`
              : "This company does not have a plan yet."}
          </CardDescription>
        </CardHeader>
        {(e.state === "trial" || e.currentPeriodEnd || e.state === "past_due_grace" || blocked) && (
        <CardContent className="grid gap-1 text-sm">
          {e.state === "trial" && e.trialEndsAt && (
            <p>
              Free trial ends on <span className="font-medium">{fmt.date(e.trialEndsAt)}</span> ({e.trialDaysLeft} day{e.trialDaysLeft === 1 ? "" : "s"} left).
            </p>
          )}
          {e.currentPeriodEnd && (
            <p>
              {e.cancelAtPeriodEnd || e.state === "canceling" ? "Access until" : "Current period ends"}: <span className="font-medium">{fmt.date(e.currentPeriodEnd)}</span>
            </p>
          )}
          {e.state === "past_due_grace" && e.graceEndsAt && (
            <p className="text-amber-700">Pay before {fmt.date(e.graceEndsAt)} to avoid a pause on adding projects, people and invoices.</p>
          )}
          {blocked && <p className="text-red-700">{blocked}</p>}
        </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage</CardTitle>
          <CardDescription>Completed and archived projects do not use a project place. People include open invitations.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <UsageMeter label="Active projects" used={e.usage.projects} limit={e.limits.projects} />
          <UsageMeter
            label="People"
            used={e.usage.users + e.usage.pendingInvites}
            limit={e.limits.users}
            hint={`${e.usage.users} with an account${e.usage.pendingInvites ? `, ${e.usage.pendingInvites} invited` : ""}`}
          />
          <UsageMeter
            label={`AI pages this month (${usage.period})`}
            used={usage.companyUsed}
            limit={usage.companyLimit ?? e.limits.companyPageCap}
            hint={`Each project gets up to ${e.limits.aiPagesPerProject} pages a month. Deleting an invoice does not give pages back.`}
          />
          {projects.length > 0 && (
            <div className="grid gap-3 border-t pt-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">By project</p>
              {projects.map((p) => (
                <UsageMeter key={p.id} label={p.name} used={usage.byProject[p.id] ?? 0} limit={p.monthlyPageLimit} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project plans</CardTitle>
          <CardDescription>
            Each project plan includes 1 project, its own users and AI pages
            {billing.plan?.priceMinor ? ` and costs ${formatMoney(billing.plan.priceMinor, billing.plan.currency)} per ${billing.plan.interval === "YEAR" ? "year" : "month"}` : ""}. To add another project, add another project plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {billing.purchases.length > 0 && (
            <ul className="grid divide-y rounded-md border text-sm">
              {billing.purchases.map((p) => {
                const ended = ["cancelled", "completed", "expired"].includes(p.status) && (!p.currentEnd || p.currentEnd <= new Date());
                const label = ended ? "Ended" : p.cancelAtCycleEnd ? "Ends at period end" : p.status === "active" ? "Active" : p.status === "authenticated" ? "Starting" : p.status === "pending" ? "Payment failed, retrying" : p.status === "halted" ? "Payment failed" : p.status === "paused" ? "Paused" : "Ends soon";
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <p className="font-medium">
                        Project plan <span className="font-normal text-muted-foreground">({formatMoney(p.amountMinor, p.currency)})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {label}
                        {p.currentEnd && !ended ? `, paid until ${fmt.date(p.currentEnd)}` : ""}
                      </p>
                    </div>
                    {!ended && !p.cancelAtCycleEnd && p.status !== "cancelled" && <CancelPlanButton purchaseId={p.id} running={p.status === "active"} />}
                  </li>
                );
              })}
            </ul>
          )}
          {billing.extraQuantity > 0 && <p className="text-sm text-muted-foreground">Plus {billing.extraQuantity} project plan{billing.extraQuantity === 1 ? "" : "s"} included by us at no charge.</p>}
          {billing.payments.length > 0 && (
            <div className="grid gap-1 text-sm">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recent payments</p>
              {billing.payments.map((p) => (
                <p key={p.id} className="flex justify-between">
                  <span>{fmt.date(p.paidAt)}{p.method ? ` (${p.method})` : ""}</span>
                  <span className="font-medium">{formatMoney(p.amountMinor, p.currency)}</span>
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-start gap-2">
            {billing.purchasable ? (
              <BuyButton priceLabel={formatMoney(billing.plan!.priceMinor!, billing.plan!.currency)} brandName={brand.name} />
            ) : (
              <Button render={<Link href={askMore} />} nativeButton={false}>
                Ask to add a project plan
              </Button>
            )}
            <Button variant="outline" render={<Link href="/support" />} nativeButton={false}>
              Contact support
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
