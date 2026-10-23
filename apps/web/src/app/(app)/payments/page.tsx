import Link from "next/link";
import { pageOrg } from "@/lib/org/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { PaymentDeleteButton } from "./payment-delete-button";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { paymentModeLabel } from "@/lib/invoices/payment-mode";

export default async function PaymentsPage() {
  const { session, db, user } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 2) => fmt.money(value, maxFraction);
  const access = invoiceAccessWhere(user);
  const projectScope = await getProjectScope(user);
  const scopedAccess = projectScope.selectedProjectId
    ? { AND: [access, { projectId: projectScope.selectedProjectId }] }
    : access;
  // Payment dates are calendar dates stored at midnight UTC, so "this month" starts on the 1st in the COMPANY's time zone.
  const monthStart = new Date(`${todayIn(await companyTimeZone(user.orgId)).slice(0, 7)}-01T00:00:00.000Z`);
  const paymentWhere = { invoice: { is: scopedAccess } };

  const [payments, payableInvoices, totals, monthTotals] = await Promise.all([
    db.payment.findMany({
      where: paymentWhere,
      include: { invoice: { include: { vendor: true, category: true, project: true } } },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    db.invoice.findMany({
      where: {
        ...scopedAccess,
        status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE", "PAID"] },
      },
      select: { total: true, payments: { select: { amount: true, paidOn: true } } },
    }),
    // Totals come from the database, not from the 200 rows shown below.
    db.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: true }),
    db.payment.aggregate({ where: { ...paymentWhere, paidOn: { gte: monthStart } }, _sum: { amount: true } }),
  ]);

  const totalPaid = Number(totals._sum.amount ?? 0);
  const paidThisMonth = Number(monthTotals._sum.amount ?? 0);
  const outstanding = payableInvoices.reduce((sum, invoice) => {
    const paid = invoice.payments.reduce((value, p) => value + Number(p.amount), 0);
    return sum + Math.max(0, Number(invoice.total) - paid);
  }, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-sm text-muted-foreground">Payment transactions linked directly to confirmed invoices.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Paid this month", formatCurrency(paidThisMonth)],
          ["Total recorded", formatCurrency(totalPaid)],
          ["Outstanding balance", formatCurrency(outstanding)],
        ].map(([label, value]) => (
          <Card key={label}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader></Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>{totals._count > payments.length ? `Latest ${payments.length} of ${totals._count} transactions` : `${payments.length} transaction(s)`}, newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <p>No payments recorded yet.</p>
              <Button className="mt-4" variant="outline" nativeButton={false} render={<Link href="/invoices" />}>Open invoices</Button>
            </div>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="space-y-3 md:hidden">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-xl border bg-card p-3.5 shadow-sm space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/invoices/${payment.invoiceId}/review`}
                          className="font-semibold text-primary underline-offset-4 hover:underline text-sm"
                        >
                          Invoice #{payment.invoice.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {payment.invoice.vendor.name}
                          {payment.invoice.category?.name ? ` · ${payment.invoice.category.name}` : ""}
                        </p>
                      </div>
                      <span className="font-semibold text-sm tabular-nums text-foreground">
                        {formatCurrency(Number(payment.amount))}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-border/60">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {fmt.date(payment.paidOn)}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {paymentModeLabel(payment.mode)}
                        </Badge>
                      </div>
                      {session.user.role === "ADMIN" && (
                        <PaymentDeleteButton invoiceId={payment.invoiceId} paymentId={payment.id} />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View: Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Vendor</TableHead><TableHead>Category</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="whitespace-nowrap">{fmt.date(payment.paidOn)}</TableCell>
                        <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/invoices/${payment.invoiceId}/review`}>{payment.invoice.invoiceNumber}</Link></TableCell>
                        <TableCell>{payment.invoice.vendor.name}</TableCell>
                        <TableCell>{payment.invoice.category?.name ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{paymentModeLabel(payment.mode)}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{payment.reference ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(Number(payment.amount))}</TableCell>
                        <TableCell className="text-right">{session.user.role === "ADMIN" && <PaymentDeleteButton invoiceId={payment.invoiceId} paymentId={payment.id} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
