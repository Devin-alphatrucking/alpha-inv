import { rawDb } from "@/lib/db";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { getEntitlements } from "@/lib/plans/entitlements";
import { listTickets, supportAddress, supportMailto } from "@/lib/flows/support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "Support" };

type Props = { searchParams: Promise<{ topic?: string }> };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  OPEN: { label: "Open", variant: "default" },
  WAITING: { label: "Waiting for you", variant: "secondary" },
  RESOLVED: { label: "Resolved", variant: "outline" },
};

export default async function SupportPage({ searchParams }: Props) {
  const { session, orgId } = await pageOrg();
  const { topic } = await searchParams;
  const fmt = await getFormat();
  const [org, e, tickets] = await Promise.all([
    rawDb.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, displayName: true, slug: true, supportEmail: true } }),
    getEntitlements(orgId),
    listTickets({ id: session.user.id, orgId, role: session.user.role }),
  ]);
  const company = org.displayName || org.name;
  const address = supportAddress();
  const planText = e.planName ? `${e.planName} x ${e.quantity} (${e.state})` : "no plan";
  const mailto = address
    ? supportMailto(address, { company, slug: org.slug, plan: planText, userName: session.user.name ?? "", userEmail: session.user.email ?? "" })
    : null;

  const preset =
    topic === "add-project"
      ? {
          subject: "Add a project plan",
          message: `We would like to add another project plan (one more project).\n\nCompany: ${company}\nCurrent plan: ${planText}\nHow many extra projects do we need: 1\n`,
        }
      : { subject: "", message: "" };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">Something not working, or a question? Tell us and we will help.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send us a request</CardTitle>
          <CardDescription>
            You will get a reference number by email. Replies come by email too. We already include your company, plan and usage, so you do not have to.
            {e.state === "active" || e.state === "past_due_grace" || e.state === "canceling" ? " Your plan gets priority support." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketForm initialSubject={preset.subject} initialMessage={preset.message} supportConfigured={Boolean(address)} />
        </CardContent>
      </Card>

      {(mailto || org.supportEmail) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prefer email?</CardTitle>
            <CardDescription>This opens your email program with your company and plan details already filled in.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            {mailto && (
              <Button variant="outline" render={<a href={mailto} />} nativeButton={false}>
                Email {address}
              </Button>
            )}
            {org.supportEmail && (
              <span className="text-muted-foreground">
                Your company&apos;s own help contact: <a className="underline underline-offset-2" href={`mailto:${org.supportEmail}`}>{org.supportEmail}</a>
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{session.user.role === "ADMIN" ? "Your company's requests" : "Your requests"}</CardTitle>
          <CardDescription>The latest 25.</CardDescription>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="grid gap-2">
              {tickets.map((t) => {
                const s = STATUS[t.status] ?? STATUS.OPEN;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <span className="tabular-nums text-muted-foreground">{t.reference}</span> {t.subject}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.user.role === "ADMIN" ? `${t.name} · ` : ""}
                        {fmt.dateTimeShort(t.createdAt)}
                        {t.resolvedAt ? ` · resolved ${fmt.date(t.resolvedAt)}` : ""}
                      </p>
                    </div>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
