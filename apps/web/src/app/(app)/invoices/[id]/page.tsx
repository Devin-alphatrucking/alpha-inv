import { hasPermission } from "@/lib/roles";
import { InvoiceComments } from "./invoice-comments";
import { InvoiceOrderMatch } from "./order-match";
import { HIGH_PERCENT, VERY_HIGH_PERCENT } from "@/lib/invoices/rate-alerts";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { paymentModeLabel } from "@/lib/invoices/payment-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoicePaymentControls } from "../invoice-payment-controls";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCESSING: "outline",
  NEEDS_REVIEW: "secondary",
  UNPAID: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

const EVENT_LABEL: Record<string, string> = {
  INVOICE_UPLOADED: "Uploaded and read by the AI",
  INVOICE_CREATED: "Reviewed and confirmed",
  INVOICE_UPDATED: "Edited",
  INVOICE_COMMENT_ADDED: "Comment added",
  INVOICE_COMMENT_DELETED: "Comment removed",
  PAYMENT_CREATED: "Payment recorded",
  PAYMENT_DELETED: "Payment removed",
};

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Invoice" };

/** A read-only view of one invoice: what it says, what was paid, and everything that happened to it. */
export default async function InvoicePage({ params }: Props) {
  const { id } = await params;
  const { session, db, user } = await pageOrg();
  const fmt = await getFormat();
  const money = (n: number) => fmt.money(n, 2);

  const invoice = await db.invoice.findFirst({
    where: { id, ...invoiceAccessWhere(user) },
    include: {
      vendor: true,
      project: { select: { id: true, name: true } },
      category: { select: { name: true } },
      lineItems: { orderBy: { id: "asc" } },
      payments: { orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }], include: { paidBy: { select: { name: true } } } },
      uploadedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  if (!invoice) notFound();
  // Drafts are finished on the review screen.
  if (invoice.status === "NEEDS_REVIEW" || invoice.status === "PROCESSING") redirect(`/invoices/${invoice.id}/review`);

  const history = await db.activityLog.findMany({
    where: { entityId: invoice.id, module: { in: ["INVOICE", "PAYMENT"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { name: true } } },
  });

  const total = Number(invoice.total);
  const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(0, total - paid);
  const canSeePayments = hasPermission(session.user.role, "payment:view");
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/invoices" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden /> All invoices
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            Invoice {invoice.invoiceNumber}
            <Badge variant={STATUS_VARIANT[invoice.status] ?? "outline"}>{invoice.status.replaceAll("_", " ")}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/vendors/${invoice.vendor.id}`} className="underline-offset-4 hover:underline">
              {invoice.vendor.name}
            </Link>
            {" · "}
            {invoice.project.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InvoicePaymentControls
            invoiceId={invoice.id}
            status={invoice.status}
            paidAt={invoice.paidAt?.toISOString() ?? null}
            invoiceNumber={invoice.invoiceNumber}
            vendorName={invoice.vendor.name}
            categoryName={invoice.category?.name ?? null}
            total={total}
            paidAmount={paid}
            compact
          />
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/invoices/${invoice.id}/review`} />}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/invoices/${invoice.id}/file`} target="_blank" rel="noreferrer" />}>
            <ExternalLink className="size-3.5" aria-hidden /> Original file
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {row("Invoice date", fmt.date(invoice.invoiceDate))}
              {invoice.dueDate && row("Due date", fmt.date(invoice.dueDate))}
              {invoice.paidAt && row("Fully paid on", fmt.date(invoice.paidAt))}
              {row("Project", invoice.project.name)}
              {invoice.category && row("Category", invoice.category.name)}
              {invoice.vendor.gstin && row("Vendor GSTIN", <span className="font-mono text-xs">{invoice.vendor.gstin}</span>)}
              {invoice.paymentTerms && row("Terms", invoice.paymentTerms)}
              {invoice.uploadedBy && row("Uploaded by", invoice.uploadedBy.name)}
              {invoice.reviewedBy && row("Confirmed by", invoice.reviewedBy.name)}
              {invoice.pageCount ? row("Pages read", invoice.pageCount) : null}
            </dl>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Amounts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {row("Subtotal", money(Number(invoice.subtotal)))}
              {Number(invoice.cgst) > 0 && row("CGST", money(Number(invoice.cgst)))}
              {Number(invoice.sgst) > 0 && row("SGST", money(Number(invoice.sgst)))}
              {Number(invoice.igst) > 0 && row("IGST", money(Number(invoice.igst)))}
              {Number(invoice.rounding) !== 0 && row("Rounding", money(Number(invoice.rounding)))}
              <div className="my-1 border-t" />
              {row("Total", <span className="text-base font-semibold">{money(total)}</span>)}
              {row("Paid", <span className="text-emerald-600">{money(paid)}</span>)}
              {row("Balance", <span className={balance > 0 ? "text-amber-600" : ""}>{money(balance)}</span>)}
            </dl>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payments ({invoice.payments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {invoice.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {invoice.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block font-medium">{fmt.date(p.paidOn)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {paymentModeLabel(p.mode)}
                        {p.reference ? ` · ${p.reference}` : ""}
                        {p.paidBy ? ` · ${p.paidBy.name}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(Number(p.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
            {canSeePayments && invoice.payments.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                To remove a payment, use <Link href="/payments" className="underline underline-offset-4">Payments</Link>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items ({invoice.lineItems.length})</CardTitle>
          <CardDescription>What was bought on this invoice.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoice.lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">This invoice has no item lines; it was confirmed on its totals.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(l.quantity)}</TableCell>
                      <TableCell>{l.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(Number(l.rateExclGst))}
                        {/* Prices are the administrators' view of the company; the saved deviation is from the whole company's history. */}
                        {hasPermission(session.user.role, "price:compare") && l.rateDeviationPercent !== null && Number(l.rateDeviationPercent) >= HIGH_PERCENT && (
                          <span className={`block text-xs font-medium ${Number(l.rateDeviationPercent) >= VERY_HIGH_PERCENT ? "text-red-600" : "text-amber-600"}`}>
                            +{Math.round(Number(l.rateDeviationPercent))}% vs usual
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{Number(l.gstPercent)}%</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(Number(l.lineTotal))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <InvoiceOrderMatch invoiceId={invoice.id} user={user} />

      <InvoiceComments invoiceId={invoice.id} user={user} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Who did what to this invoice, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history recorded.</p>
          ) : (
            <ol className="relative grid gap-4 border-l pl-5">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border bg-background" aria-hidden />
                  <p className="text-sm font-medium">{EVENT_LABEL[h.action] ?? h.action.replaceAll("_", " ").toLowerCase()}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.user?.name ?? "System"} · {fmt.dateTime(h.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
