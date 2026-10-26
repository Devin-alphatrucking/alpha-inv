import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Plus, ShoppingCart } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";
import { listRequests, purchaseOverview } from "@/lib/flows/purchase";
import { REQUEST_LABEL } from "@/lib/purchase/rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestBadge } from "./badges";

const FILTERS = ["SUBMITTED", "APPROVED", "ORDERED", "DRAFT", "REJECTED", "CANCELLED"] as const;

export default async function PurchasePage({ searchParams }: { searchParams: Promise<{ status?: string; project?: string }> }) {
  const { user } = await pageOrg();
  if (!hasPermission(user.role, "request:view")) redirect("/dashboard");
  const params = await searchParams;
  const fmt = await getFormat();
  const scope = await getProjectScope(user);
  const filter = (FILTERS as readonly string[]).includes(params.status ?? "") ? (params.status as (typeof FILTERS)[number]) : null;
  const projectId = scope.projects.some((p) => p.id === params.project) ? params.project! : scope.selectedProjectId;
  const [overview, requests] = await Promise.all([purchaseOverview(user), listRequests(user, { projectId, take: 200 })]);
  const shown = filter ? requests.filter((r) => r.status === filter) : requests;
  const canOrders = hasPermission(user.role, "order:view");
  const canWrite = hasPermission(user.role, "request:write");
  const raiseIn = projectId ?? scope.projects.find((p) => p.status === "ACTIVE")?.id ?? null;
  const q = (status?: string) => `/purchase?${new URLSearchParams({ ...(params.project ? { project: params.project } : {}), ...(status ? { status } : {}) }).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ShoppingCart className="size-6" aria-hidden /> Purchase</h1>
          <p className="text-sm text-muted-foreground">Material requests from site, approval, and purchase orders to suppliers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOrders && <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/purchase/orders" />}><ClipboardList className="size-4" aria-hidden /> Purchase orders</Button>}
          {canWrite && raiseIn && <Button size="sm" nativeButton={false} render={<Link href={`/purchase/requests/new?project=${raiseIn}`} />}><Plus className="size-4" aria-hidden /> New request</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Waiting for approval", String(overview.waitingForApproval), q("SUBMITTED")],
          ["Approved, not ordered yet", String(overview.approvedToOrder), q("APPROVED")],
          ...(canOrders ? [["Draft orders", String(overview.draftOrders), "/purchase/orders?status=DRAFT"], ["Sent, value", fmt.money(overview.sentValueMinor / 100), "/purchase/orders?status=SENT"]] : []),
        ].map(([label, value, href]) => (
          <Link key={label} href={href} className="block rounded-xl focus-visible:outline-2">
            <Card className="h-full transition-colors hover:bg-muted/40"><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader></Card>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter requests">
        <Button size="sm" variant={!filter ? "default" : "outline"} nativeButton={false} render={<Link href={q()} />}>All</Button>
        {FILTERS.map((s) => <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} nativeButton={false} render={<Link href={q(s)} />}>{REQUEST_LABEL[s]}</Button>)}
      </div>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No requests here{canWrite ? ". Use New request to ask for materials." : "."}</p>
          ) : (
            <ul className="divide-y">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link href={`/purchase/requests/${r.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.number} · {r.projectName}</span>
                      <RequestBadge status={r.status} />
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {r.lines.map((l) => `${l.description} ${l.quantity} ${l.unit}`).join(", ")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[`by ${r.requestedByName ?? "a former member"}`, r.neededBy ? `needed by ${fmt.date(new Date(`${r.neededBy}T00:00:00Z`))}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
