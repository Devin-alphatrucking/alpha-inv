import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { hasPermission } from "@/lib/roles";
import { getProjectScope } from "@/lib/projects/scope";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { getRequest, suppliers } from "@/lib/flows/purchase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderForm } from "../order-form";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ project?: string; request?: string }> }) {
  const { user, db } = await pageOrg();
  if (!hasPermission(user.role, "order:write")) redirect("/purchase");
  const params = await searchParams;
  const request = params.request ? await getRequest(user, params.request) : null;
  const canUseRequest = request && (request.status === "APPROVED" || request.status === "ORDERED");
  const scope = await getProjectScope(user);
  const active = scope.projects.filter((p) => p.status === "ACTIVE");
  const project = canUseRequest ? scope.projects.find((p) => p.id === request.projectId) : active.find((p) => p.id === params.project) ?? active.find((p) => p.id === scope.selectedProjectId) ?? active[0];
  const today = todayIn(await companyTimeZone(user.orgId));
  const [list, projectRow] = await Promise.all([suppliers(user), project ? db.project.findFirst({ where: { id: project.id }, select: { address: true } }) : null]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" nativeButton={false} render={<Link href={request ? `/purchase/requests/${request.id}` : "/purchase/orders"} />}><ArrowLeft className="size-4" aria-hidden /> Back</Button>
        <h1 className="text-2xl font-semibold tracking-tight">New purchase order</h1>
        <p className="text-sm text-muted-foreground">
          {project ? project.name : "No project"}
          {canUseRequest && ` · from request ${request.number}. Fill in the supplier and the rates.`}
        </p>
      </div>
      {request && !canUseRequest && <Card className="border-destructive/40"><CardContent className="py-4 text-sm">Request {request.number} is {request.status.toLowerCase()}, so it cannot be ordered. You can still make an order without it.</CardContent></Card>}
      {!project ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">There is no active project to order for.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Order details</CardTitle></CardHeader>
          <CardContent>
            <OrderForm
              projectId={project.id}
              requestId={canUseRequest ? request.id : null}
              suppliers={list}
              initial={{
                vendorId: "", orderDate: today, deliveryDate: canUseRequest ? request.neededBy ?? "" : "", deliveryAddress: projectRow?.address ?? "", paymentTerms: "", note: "",
                lines: canUseRequest ? request.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, rate: "", gstPercent: "18", materialId: l.materialId })) : [],
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
