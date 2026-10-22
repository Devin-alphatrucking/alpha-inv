import Link from "next/link";
import { listTickets, PAGE_SIZE } from "@/lib/master/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FilterBar, PageTitle, Pager, fmtDateTime } from "../master-ui";

export const metadata = { title: "Tickets | Master console" };
export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; status?: string; page?: string }>;
const ref = (n: number) => `SUP-${String(n).padStart(6, "0")}`;

export default async function TicketsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = sp.status ?? "ACTIVE";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, byStatus } = await listTickets({ q, status, page });

  return (
    <>
      <PageTitle title="Support tickets">
        Requests customers raised from the app. {byStatus.OPEN ?? 0} open, {byStatus.WAITING ?? 0} waiting on the customer, {byStatus.RESOLVED ?? 0} resolved. Reply by email, then set the status here.
      </PageTitle>

      <FilterBar action="/master/tickets">
        <div className="grid gap-1.5">
          <label htmlFor="q" className="text-xs text-muted-foreground">Search</label>
          <Input id="q" name="q" defaultValue={q} placeholder="Subject, email, company or SUP number" className="w-72" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="status" className="text-xs text-muted-foreground">Status</label>
          <select id="status" name="status" defaultValue={status} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="ACTIVE">Not resolved</option>
            <option value="OPEN">Open</option>
            <option value="WAITING">Waiting on customer</option>
            <option value="RESOLVED">Resolved</option>
            <option value="">All</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No tickets match.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((t) => (
                <li key={t.id}>
                  <Link href={`/master/tickets/${t.id}`} className="grid gap-1 p-4 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{ref(t.number)}</span>
                        {t.subject}
                      </span>
                      <span className="flex gap-1.5">
                        {t.priority === "HIGH" && <Badge variant="destructive">Paid plan</Badge>}
                        <Badge variant={t.status === "RESOLVED" ? "outline" : t.status === "WAITING" ? "secondary" : "default"}>{t.status}</Badge>
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.organization.name} · {t.name} ({t.email}) · {fmtDateTime(t.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager basePath="/master/tickets" params={{ q, status }} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
