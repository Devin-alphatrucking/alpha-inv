import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getFormat } from "@/lib/brand/brand";
import { getRequest } from "@/lib/flows/purchase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrderBadge, RequestBadge } from "../../badges";
import { RequestActions } from "../request-actions";
import { RequestForm } from "../request-form";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "request:view")) redirect("/dashboard");
  const { id } = await params;
  const request = await getRequest(user, id);
  if (!request) notFound();
  const fmt = await getFormat();
  const date = (s: string | null) => (s ? fmt.date(new Date(`${s}T00:00:00Z`)) : "—");
  const editing = (await searchParams).edit === "1" && request.actions.includes("edit");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href="/purchase" />}><ArrowLeft className="size-4" aria-hidden /> Purchase</Button>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{request.number} <RequestBadge status={request.status} /></h1>
        <p className="text-sm text-muted-foreground">
          {request.projectName} · raised by {request.requestedByName ?? "a former member"} on {fmt.date(request.createdAt)}
          {request.neededBy && ` · needed by ${date(request.neededBy)}`}
        </p>
      </div>

      {request.status === "REJECTED" && (
        <Card className="border-destructive/40"><CardContent className="py-4 text-sm"><span className="font-medium">Rejected{request.decidedByName ? ` by ${request.decidedByName}` : ""}:</span> {request.decisionNote}</CardContent></Card>
      )}
      {(request.status === "APPROVED" || request.status === "ORDERED") && (
        <Card><CardContent className="py-4 text-sm"><span className="font-medium">Approved{request.decidedByName ? ` by ${request.decidedByName}` : ""}</span>{request.decisionNote ? `: ${request.decisionNote}` : "."}</CardContent></Card>
      )}

      {editing ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Change the request</CardTitle></CardHeader>
          <CardContent>
            <RequestForm
              projectId={request.projectId}
              requestId={request.id}
              initial={{ neededBy: request.neededBy ?? "", note: request.note ?? "", lines: request.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, rate: "", gstPercent: "18", materialId: l.materialId })) }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Unit</TableHead></TableRow></TableHeader>
              <TableBody>
                {request.lines.map((l, i) => (
                  <TableRow key={l.id}><TableCell>{i + 1}</TableCell><TableCell>{l.description}</TableCell><TableCell className="text-right tabular-nums">{l.quantity}</TableCell><TableCell>{l.unit}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
            {request.note && <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">Note:</span> {request.note}</p>}
          </CardContent>
        </Card>
      )}

      {!editing && request.actions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">What next</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {request.actions.includes("edit") && <div><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/purchase/requests/${request.id}?edit=1`} />}>Change the request</Button></div>}
            <RequestActions requestId={request.id} projectId={request.projectId} actions={request.actions} />
          </CardContent>
        </Card>
      )}

      {request.orders.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Purchase orders from this request</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {request.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2"><Link href={`/purchase/orders/${o.id}`} className="text-sm font-medium hover:underline">{o.number}</Link><OrderBadge status={o.status} /></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
