import Link from "next/link";
import { notFound } from "next/navigation";
import { ticketDetail } from "@/lib/master/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDateTime } from "../../master-ui";
import { TicketStatusButtons } from "../../master-client";

export const metadata = { title: "Ticket | Master console" };
export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await ticketDetail(id);
  if (!t) notFound();
  const reference = `SUP-${String(t.number).padStart(6, "0")}`;
  const mailto = `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`Re: [${reference}] ${t.subject}`)}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={`${reference}: ${t.subject}`}>
          {t.name} ({t.email}) · {fmtDateTime(t.createdAt)}
        </PageTitle>
        <Link href="/master/tickets" className="text-sm underline-offset-4 hover:underline">
          All tickets
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Link href={`/master/companies/${t.organization.id}`} className="underline-offset-4 hover:underline">
              {t.organization.name}
            </Link>
            <Badge variant="outline">{t.planCode ?? "no plan"}</Badge>
            {t.priority === "HIGH" && <Badge variant="destructive">Paid plan: reply first</Badge>}
          </CardTitle>
          <CardDescription>The customer wrote:</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm">{t.body}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button render={<a href={mailto} />} nativeButton={false} size="sm">
              Reply by email
            </Button>
            <span className="text-xs text-muted-foreground">Replies stay in email. Set the status below when you have answered.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>{t.resolvedAt ? `Resolved ${fmtDateTime(t.resolvedAt)}.` : "Not resolved yet."} Changes are written to the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <TicketStatusButtons ticketId={t.id} current={t.status} />
        </CardContent>
      </Card>
    </>
  );
}
