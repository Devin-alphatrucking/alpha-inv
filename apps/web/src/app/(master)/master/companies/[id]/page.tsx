import Link from "next/link";
import { notFound } from "next/navigation";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { companyDetail } from "@/lib/master/queries";
import { logActivity } from "@/lib/activity";
import { parseOverrides } from "@/lib/plans/rules";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMeter } from "@/components/usage-meter";
import { CompanyStatusBadge, DueBadge, HealthLabel, PageTitle, StageBadge, StateBadge, fmtDate, fmtDateTime, isoDay, money } from "../../master-ui";
import { DoneButton, FollowUpForm, NoteForm } from "../../care-client";
import { dueTone, todayUtc } from "@/lib/master/health";
import { formatPhone } from "@/lib/security/phone";
import { ActionForm, ReconcileButton, ResetTwoStepControl } from "../../master-client";
import { extendTrialAction, setCompanyStatusAction, setLimitsAction, setProjectPlansAction } from "../../actions";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Company | Master console" };
export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await pagePlatformAdmin();
  const { id } = await params;
  const d = await companyDetail(id);
  if (!d) notFound();
  const { org, entitlements: e, purchases, payments, members, projects, activity, tickets, invoices, notes, followUps, health, usage30 } = d;
  const today = todayUtc();
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
          <CardTitle className="text-base">Use in the last 30 days</CardTitle>
          <CardDescription>Actions recorded in the activity log, by part of the product.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["AUTH", "Sign-ins"],
            ["INVOICE", "Invoices"],
            ["PAYMENT", "Payments"],
            ["PURCHASE", "Purchase"],
            ["SITE", "Site work"],
            ["VENDOR", "Vendors"],
          ].map(([key, label]) => (
            <div key={key} className="rounded-lg border px-3 py-2">
              <p className="text-xl font-semibold tabular-nums">{usage30[key] ?? 0}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Client care
            {health && (
              <>
                <StageBadge stage={health.stage} />
                <HealthLabel level={health.level} />
              </>
            )}
          </CardTitle>
          <CardDescription>
            {health?.lastActiveAt ? `Last activity ${fmtDateTime(health.lastActiveAt)}.` : "No activity from this company yet."}
            {sub?.trialEndingNoticeAt ? ` Trial-ending email sent ${fmtDate(sub.trialEndingNoticeAt)}.` : ""}
            {sub?.trialEndedNoticeAt ? ` Trial-ended email sent ${fmtDate(sub.trialEndedNoticeAt)}.` : ""}
            {health && health.trialDaysLeft !== null ? ` Trial: ${health.trialDaysLeft} day${health.trialDaysLeft === 1 ? "" : "s"} left.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 lg:grid-cols-2">
          <section className="grid content-start gap-4">
            {health && health.reasons.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {health.reasons.map((r) => (
                  <li key={r.text} className="flex items-center gap-2">
                    <span aria-hidden className={`size-2 rounded-full ${r.severity === "high" ? "bg-red-500" : r.severity === "medium" ? "bg-amber-500" : "bg-slate-400"}`} />
                    {r.text}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="text-sm font-semibold">Follow-ups</h3>
            <div className="grid gap-2">
              {followUps.length === 0 && <p className="text-sm text-muted-foreground">Nothing planned.</p>}
              {followUps.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className={f.doneAt ? "text-muted-foreground line-through" : "font-medium"}>{f.task}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.doneAt ? `Done ${fmtDate(f.doneAt)} by ${f.doneByEmail}` : `${fmtDate(f.dueOn)} · added by ${f.createdByEmail}`}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    {!f.doneAt && <DueBadge tone={dueTone(f.dueOn, today)} />}
                    <DoneButton id={f.id} done={!!f.doneAt} />
                  </span>
                </div>
              ))}
            </div>
            <FollowUpForm orgId={org.id} today={isoDay(today)} />
          </section>
          <section className="grid content-start gap-4">
            <h3 className="text-sm font-semibold">Notes ({notes.length})</h3>
            <NoteForm orgId={org.id} />
            <div className="grid gap-2">
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg border px-3 py-2 text-sm">
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{n.authorEmail} · {fmtDateTime(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export this company&apos;s data</CardTitle>
          <CardDescription>
            For when the company asks for a copy of its data or is leaving. Everything the company can export itself (invoices, line items, payments, suppliers, people, comments, logs), as an Excel workbook or a JSON backup. Needs a reason and is written to the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/master/export" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={org.id} />
            <div className="grid gap-1.5">
              <label htmlFor="export-format" className="text-xs text-muted-foreground">Format</label>
              <NativeSelect id="export-format" name="format" defaultValue="xlsx">
                <option value="xlsx">Excel workbook</option>
                <option value="json">JSON backup</option>
              </NativeSelect>
            </div>
            <div className="grid min-w-64 flex-1 gap-1.5">
              <label htmlFor="export-reason" className="text-xs text-muted-foreground">Reason (kept in the audit log)</label>
              <Input id="export-reason" name="reason" required minLength={3} maxLength={300} placeholder="For example: customer asked for a copy by email" />
            </div>
            <Button type="submit">Download</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">People ({members.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {members.map((m) => {
              const canReset = Boolean(m.user.totpEnabledAt) && !m.user.deletedAt && !m.user.isPlatformAdmin && m.userId !== admin.id;
              return (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {m.user.deletedAt ? <span className="text-muted-foreground">(deleted account)</span> : `${m.user.name} · ${m.user.email}${m.user.phone ? ` · ${formatPhone(m.user.phone)}` : ""}`}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {!m.user.emailVerifiedAt && !m.user.deletedAt && <Badge variant="outline">unverified</Badge>}
                    {m.user.totpEnabledAt && !m.user.deletedAt && <Badge variant="outline">two-step on</Badge>}
                    <Badge variant={m.role === "ADMIN" ? "default" : "secondary"}>{m.role}</Badge>
                    {canReset && <ResetTwoStepControl orgId={org.id} userId={m.userId} name={m.user.name} />}
                  </span>
                </div>
              );
            })}
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
