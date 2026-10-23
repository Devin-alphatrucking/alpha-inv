import { InvoiceComments } from "../invoice-comments";
import { notFound, redirect } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import { ReviewForm } from "./review-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getFormat } from "@/lib/brand/brand";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { loadRateBaselines } from "@/lib/invoices/rate-baseline";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoiceReviewPage({ params }: PageProps) {
  const { id } = await params;
  const { session, db, user } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 0) => fmt.money(value, maxFraction);

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      lineItems: true,
      category: true,
      payments: {
        orderBy: { paidOn: "desc" },
        include: { paidBy: { select: { id: true, name: true } } },
      },
    },
  });

  if (!invoice) notFound();

  if (session.user.role === "STAFF") {
    const isUploader = invoice.uploadedById === session.user.id;
    const assignment = await db.projectAssignment.findFirst({
      where: { userId: session.user.id, projectId: invoice.projectId },
    });
    if (!isUploader && !assignment) {
      redirect("/invoices/upload");
    }
  }

  const [vendors, categories, projects] = await Promise.all([
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    session.user.role === "STAFF"
      ? db.project.findMany({
          where: { assignments: { some: { userId: session.user.id } } },
          orderBy: { name: "asc" },
        })
      : db.project.findMany({ orderBy: { name: "asc" } }),
  ]);

  // What the company usually pays for each item, to warn when a rate here is much higher. Staff are judged only against invoices they can see.
  const rateBaselines = Object.fromEntries(
    await loadRateBaselines(db, invoice.id, invoice.lineItems, invoiceAccessWhere(user)),
  );

  const raw = invoice.extractionRaw as
    | {
        _normalized?: { lineItemConfidences?: number[] };
        customTaxes?: { id?: string; title: string; amount: number }[];
      }
    | null;
  const itemConfidences = raw?._normalized?.lineItemConfidences ?? [];
  const customTaxes = raw?.customTaxes ?? [];

  const duplicate = await db.invoice.findFirst({
    where: {
      vendorId: invoice.vendorId,
      invoiceNumber: invoice.invoiceNumber.replace(/-REVIEW-\d+$/, ""),
      id: { not: invoice.id },
    },
    select: { id: true },
  });

  // Also flag if number was rewritten with -REVIEW- suffix during upload
  const possibleDuplicate =
    Boolean(duplicate) || /-REVIEW-\d+$/.test(invoice.invoiceNumber);

  return (
    <div className="space-y-6">
      <ReviewForm
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber.replace(/-REVIEW-\d+$/, ""),
          invoiceDate: invoice.invoiceDate.toISOString(),
          dueDate: invoice.dueDate?.toISOString() ?? null,
          vendorId: invoice.vendorId,
          categoryId: invoice.categoryId,
          categoryName: invoice.category?.name ?? null,
          projectId: invoice.projectId,
          subtotal: Number(invoice.subtotal),
          sgst: Number(invoice.sgst),
          cgst: Number(invoice.cgst),
          igst: Number(invoice.igst),
          total: Number(invoice.total),
          customTaxes,
          fileUrl: invoice.fileUrl,
          status: invoice.status,
          paidAt: invoice.paidAt?.toISOString() ?? null,
          paidAmount: invoice.payments.reduce(
            (sum, payment) => sum + Number(payment.amount),
            0
          ),
          vendor: {
            id: invoice.vendor.id,
            name: invoice.vendor.name,
            gstin: invoice.vendor.gstin,
          },
          lineItems: invoice.lineItems.map((li, i) => ({
            id: li.id,
            description: li.description,
            quantity: Number(li.quantity),
            unit: li.unit,
            rateExclGst: Number(li.rateExclGst),
            gstPercent: Number(li.gstPercent),
            confidence: itemConfidences[i],
          })),
        }}
        vendors={vendors.map((v) => ({
          id: v.id,
          name: v.name,
          gstin: v.gstin,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          unit: c.unit,
        }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        possibleDuplicate={possibleDuplicate}
        rateBaselines={rateBaselines}
      />

      <div className="mx-auto w-full max-w-5xl">
        <InvoiceComments invoiceId={invoice.id} user={user} />
      </div>

      {invoice.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment history</CardTitle>
            <CardDescription>
              {invoice.payments.length} payment(s) recorded against this invoice
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoice.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium tabular-nums">
                      {formatCurrency(Number(payment.amount), 2)}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fmt.dateTime(payment.paidOn)} · {payment.mode ?? "Other"}
                      {payment.reference ? ` · ref ${payment.reference}` : ""}
                      {payment.paidBy ? ` · by ${payment.paidBy.name}` : ""}
                    </span>
                    {payment.notes && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {payment.notes}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
