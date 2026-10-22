import Link from "next/link";
import { notFound } from "next/navigation";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { companyDetail } from "@/lib/master/queries";
import { logActivity } from "@/lib/activity";
import { parseOverrides } from "@/lib/plans/rules";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMeter } from "@/components/usage-meter";
import { CompanyStatusBadge, PageTitle, StateBadge, fmtDate, fmtDateTime, money } from "../../master-ui";
import { ActionForm, ReconcileButton } from "../../master-client";
import { extendTrialAction, setCompanyStatusAction, setLimitsAction, setProjectPlansAction } from "../../actions";

export const metadata = { title: "Company | Master console" };
export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await pagePlatformAdmin();
  const { id } = await params;
  const d = await companyDetail(id);
  if (!d) notFound();
  const { org, entitlements: e, purchases, payments, members, projects, activity, tickets, invoices } = d;
  const sub = org.subscription;
  const o = parseOverrides(sub?.overrides);
  const razorpay = sub?.billing === "RAZORPAY";

  // Looking at a company's data is itself recorded, so there is always a trail of who looked and when.
  await logActivity({ userId: admin.id, organizationId: org.id, action: "MASTER_VIEWED_COMPANY", module: "MASTER", entityId: org.id, details: { by: admin.email } });

  const bindPlans = setProjectPlansAction.bind(null, org.id);
  const bindTrial = extendTrialAction.bind(null, org.id);
  const bindLimits = setLimitsAction.bind(null, org.id);
  const suspend = setCompanyStatusAction.bind(null, org.id, "SUSPENDED");
  const reactivate = setCompanyStatusAction.bind(null, org.id, "ACTIVE");

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={org.name}>
          Code <span className="font-mono">{org.slug}</span> · joined {fmtDate(org.createdAt)} · {org.country}
        </PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={e.state} />
          <CompanyStatusBadge status={org.status} />
          <Link href="/master/companies" className="text-sm underline-offset-4 hover:underline">
            All companies
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan and usage</CardTitle>
            <CardDescription>
              {e.planName ?? "No plan"}: {e.quantity} project plan{e.quantity === 1 ? "" : "s"} ({razorpay ? "pays through Razorpay" : "managed by hand"}).
              {sub?.trialEndsAt && e.state === "trial" ? ` Trial ends ${fmtDate(sub.trialEndsAt)}.` : ""}
              {sub?.currentPeriodEnd ? ` Period ends ${fmtDate(sub.currentPeriodEnd)}.` : ""}
              {sub?.graceEndsAt && e.state === "past_due_grace" ? ` Grace ends ${fmtDate(sub.graceEndsAt)}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <UsageMeter label="Active projects" used={e.usage.projects} limit={e.limits.projects} />
            <UsageMeter label="People (with open invitations)" used={e.usage.users + e.usage.pendingInvites} limit={e.limits.users} />
            <p className="text-xs text-muted-foreground">
              {invoices} invoice{invoices === 1 ? "" : "s"} · AI pages per project {e.limits.aiPagesPerProject} · company cap {e.limits.companyPageCap}
              {(o.extraProjects || o.extraUsers || o.aiPagesPerProject !== null) && ` · overrides: +${o.extraProjects} projects, +${o.extraUsers} users${o.aiPagesPerProject !== null ? `, ${o.aiPagesPerProject} pages` : ""}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing</CardTitle>
            <CardDescription>
              {purchases.filter((p) => p.status !== "created").length} purchase{purchases.length === 1 ? "" : "s"}, {payments.length} recent payment{payments.length === 1 ? "" : "s"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {purchases.length === 0 && <p className="text-muted-foreground">No purchases yet.</p>}
            {purchases.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div>
                  <p className="font-medium">
                    {money(p.amountMinor, p.currency)} <span className="font-normal text-muted-foreground">· {p.status}</span>
                    {p.cancelAtCycleEnd && <span className="font-normal text-muted-foreground"> · ends at period end</span>}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{p.providerSubscriptionId}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>paid {p.paidCount}x</p>
                  <p>until {fmtDate(p.currentEnd)}</p>
                </div>
              </div>
            ))}
            {payments.length > 0 && (
              <div className="grid gap-1">
                {payments.slice(0, 5).map((p) => (
                  <p key={p.id} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{fmtDateTime(p.paidAt)}{p.method ? ` · ${p.method}` : ""}</span>
                    <span className="font-medium">{money(p.amountMinor, p.currency)}</span>
                  </p>
                ))}
              </div>
            )}
            {razorpay && <ReconcileButton orgId={org.id} />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change this company</CardTitle>
          <CardDescription>Every change needs a reason and is written to the audit log against this company.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 lg:grid-cols-2">
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">{razorpay ? "Free project plans" : "Project plans"}</h3>
            <p className="text-xs text-muted-foreground">
              {razorpay ? "Plans given at no charge, on top of the ones this company pays for." : "This company is managed by hand: this is its total number of project plans."}
            </p>
            <ActionForm action={bindPlans} submit="Save" fields={[{ name: "count", label: razorpay ? "Free plans" : "Project plans", type: "number", min: 0, defaultValue: razorpay ? (sub?.extraQuantity ?? 0) : (sub?.quantity ?? 1) }]} />
          </section>
          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">Extend the trial</h3>
            <p className="text-xs text-muted-foreground">Adds days to the end of the current trial (or to today if it has ended).</p>
            <ActionForm action={bindTrial} submit="Extend" fields={[{ name: "days", label: "Days to add", type: "number", min: 1, max: 365, defaultValue: 7 }]} />
          </section>
          <section className="grid gap-3 lg:col-span-2">
            <h3 className="text-sm font-semibold">Extra limits for this company only</h3>
            <p className="text-xs text-muted-foreground">On top of what its plans include. Leave AI pages empty to use the plan&apos;s value.</p>
            <ActionForm
              action={bindLimits}
              submit="Save limits"
              fields={[
                { name: "extraProjects", label: "Extra projects", type: "number", min: 0, defaultValue: o.extraProjects },
                { name: "extraUsers", label: "Extra people", type: "number", min: 0, defaultValue: o.extraUsers },
                { name: "aiPages", label: "AI pages per project", type: "number", min: 0, defaultValue: o.aiPagesPerProject, placeholder: "Plan default" },
              ]}
            />
          </section>
          <section className="grid gap-3 lg:col-span-2">
            <h3 className="text-sm font-semibold">{org.status === "SUSPENDED" ? "Reactivate this company" : "Suspend this company"}</h3>
            <p className="text-xs text-muted-foreground">
              {org.status === "SUSPENDED"
                ? "Lets everyone in the company sign in again."
                : "Nobody in the company can sign in until it is reactivated. Data is kept. Use for abuse or a legal request, not for late payment (that pauses growth by itself)."}
            </p>
            {org.status === "SUSPENDED" ? (
              <ActionForm action={reactivate} submit="Reactivate" fields={[]} />
            ) : (
              <ActionForm action={suspend} submit="Suspend company" destructive confirmText={`Suspend ${org.name}? Everyone in it will be signed out within a minute.`} fields={[]} />
            )}
          </section>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">People ({members.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {members.map((m) => (
              <p key={m.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {m.user.deletedAt ? <span className="text-muted-foreground">(deleted account)</span> : `${m.user.name} · ${m.user.email}`}
                </span>
                <span className="flex shrink-0 gap-1">
                  {!m.user.emailVerifiedAt && !m.user.deletedAt && <Badge variant="outline">unverified</Badge>}
                  <Badge variant={m.role === "ADMIN" ? "default" : "secondary"}>{m.role}</Badge>
                </span>
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projects ({projects.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {projects.length === 0 && <p className="text-muted-foreground">No projects.</p>}
            {projects.map((p) => (
              <p key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.status} · {p.monthlyPageLimit} pages/month
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Support tickets</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {tickets.length === 0 && <p className="text-muted-foreground">None.</p>}
            {tickets.map((t) => (
              <Link key={t.id} href={`/master/tickets/${t.id}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 hover:bg-muted/40">
                <span className="truncate">
                  <span className="font-mono text-xs text-muted-foreground">SUP-{String(t.number).padStart(6, "0")}</span> {t.subject}
                </span>
                <Badge variant={t.status === "RESOLVED" ? "outline" : "secondary"}>{t.status}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>
              <Link href={`/master/logs?org=${org.id}`} className="underline-offset-4 hover:underline">
                Open the full log for this company
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-xs">
            {activity.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
            {activity.map((a) => (
              <p key={a.id} className="flex justify-between gap-2">
                <span className="truncate">
                  <span className="font-mono font-semibold">{a.action}</span> <span className="text-muted-foreground">{a.user?.email ?? "system"}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
