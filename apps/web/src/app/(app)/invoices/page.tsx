import { Suspense } from "react";
import Link from "next/link";
import { pageOrg } from "@/lib/org/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Upload } from "lucide-react";
import type { Prisma } from "@alpha/db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { InvoiceFilters } from "./invoice-filters";
import { InvoicePaymentControls } from "./invoice-payment-controls";
import { InvoiceDeleteButton } from "./invoice-delete-button";
import { InvoiceFilePreview } from "@/components/invoice-file-preview";
import { getProjectScope } from "@/lib/projects/scope";
import { getFormat } from "@/lib/brand/brand";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PROCESSING: "outline",
  NEEDS_REVIEW: "secondary",
  UNPAID: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

type SearchParams = Promise<{
  confirmed?: string;
  updated?: string;
  q?: string;
  vendorId?: string;
  categoryId?: string;
  status?: string;
  from?: string;
  to?: string;
}>;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session, db, user } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 0) => fmt.money(value, maxFraction);

  const params = await searchParams;
  const isStaff = session.user.role === "STAFF";

  const accessWhere = invoiceAccessWhere(user);
  const projectScope = await getProjectScope(user);
  const userProjectIds = new Set(projectScope.projects.map((p) => p.id));

  const andFilters: Prisma.InvoiceWhereInput[] = [];
  if (projectScope.selectedProjectId) {
    andFilters.push({ projectId: projectScope.selectedProjectId });
  }
  if (params.vendorId) andFilters.push({ vendorId: params.vendorId });
  if (params.categoryId) andFilters.push({ categoryId: params.categoryId });
  if (params.status) {
    andFilters.push({
      status: params.status as
        | "PROCESSING"
        | "NEEDS_REVIEW"
        | "UNPAID"
        | "PARTIALLY_PAID"
        | "PAID"
        | "OVERDUE",
    });
  }
  if (params.q?.trim()) {
    const q = params.q.trim();
    andFilters.push({
      OR: [
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { vendor: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (params.from) {
    andFilters.push({ invoiceDate: { gte: new Date(params.from) } });
  }
  if (params.to) {
    const end = new Date(params.to);
    end.setHours(23, 59, 59, 999);
    andFilters.push({ invoiceDate: { lte: end } });
  }

  const where: Prisma.InvoiceWhereInput = {
    AND: [
      accessWhere,
      ...(andFilters.length > 0 ? andFilters : []),
    ],
  };

  const [invoices, vendors, categories] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        vendor: true,
        project: true,
        category: true,
        payments: { select: { amount: true } },
      },
      orderBy: [{ status: "asc" }, { invoiceDate: "desc" }],
      take: 100,
    }),
    db.vendor.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isStaff ? "My invoices" : "Invoices"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isStaff
              ? "Uploads and drafts awaiting your review."
              : "Filter by vendor, category, status, and date."}
          </p>
        </div>
        <Button
          className="w-full sm:w-auto"
          nativeButton={false}
          render={<Link href="/invoices/upload" />}
        >
          <Upload className="size-4" />
          Upload invoice
        </Button>
      </div>

      {params.confirmed && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Invoice confirmed and saved as unpaid.
        </div>
      )}

      {params.updated && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          Invoice changes saved successfully.
        </div>
      )}

      <Suspense fallback={null}>
        <InvoiceFilters vendors={vendors} categories={categories} />
      </Suspense>

      <Card className="transition-shadow duration-200 hover:shadow-sm">
        <CardHeader>
          <CardTitle>{isStaff ? "Your invoices" : "All invoices"}</CardTitle>
          <CardDescription>
            {invoices.length} shown · newest first
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-14 text-center">
              <div className="rounded-full bg-muted p-4">
                <FileText className="size-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No invoices match</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Try clearing filters or upload a purchase invoice.
                </p>
              </div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/invoices/upload" />}
              >
                Upload invoice
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <Link
                      href={`/invoices/${invoice.id}/review`}
                      className="block"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {invoice.invoiceNumber}
                          </p>
                          <p className="truncate text-sm text-muted-foreground">
                            {invoice.vendor.name}
                            {invoice.category?.name
                              ? ` · ${invoice.category.name}`
                              : ""}
                          </p>
                        </div>
                        <Badge
                          variant={STATUS_VARIANT[invoice.status] ?? "outline"}
                        >
                          {invoice.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {fmt.date(invoice.invoiceDate)}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(Number(invoice.total))}
                        </span>
                      </div>
                    </Link>
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <div className="flex items-start justify-between gap-2">
                        <InvoiceFilePreview
                          invoiceId={invoice.id}
                          fileUrl={invoice.fileUrl}
                          className="min-w-0 flex-1 max-w-full overflow-hidden"
                        />
                        {(!isStaff || invoice.uploadedById === session.user.id || userProjectIds.has(invoice.projectId)) && (
                          <div className="shrink-0 pt-0.5">
                            <InvoiceDeleteButton
                              invoiceId={invoice.id}
                              invoiceNumber={invoice.invoiceNumber}
                              vendorName={invoice.vendor.name}
                            />
                          </div>
                        )}
                      </div>
                      <InvoicePaymentControls
                        invoiceId={invoice.id}
                        status={invoice.status}
                        paidAt={invoice.paidAt?.toISOString() ?? null}
                        invoiceNumber={invoice.invoiceNumber}
                        vendorName={invoice.vendor.name}
                        categoryName={invoice.category?.name ?? null}
                        total={Number(invoice.total)}
                        paidAmount={invoice.payments.reduce(
                          (sum, payment) => sum + Number(payment.amount),
                          0
                        )}
                        compact
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid at</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => {
                      const paidAmount = invoice.payments.reduce(
                        (sum, payment) => sum + Number(payment.amount),
                        0
                      );
                      const balance = Math.max(0, Number(invoice.total) - paidAmount);
                      return (
                        <TableRow
                          key={invoice.id}
                          className="transition-colors hover:bg-muted/40"
                        >
                          <TableCell className="font-medium">
                            <Link
                              href={`/invoices/${invoice.id}/review`}
                              className="hover:underline font-semibold"
                            >
                              {invoice.invoiceNumber}
                            </Link>
                          </TableCell>
                          <TableCell>{invoice.vendor.name}</TableCell>
                          <TableCell>{invoice.project.name}</TableCell>
                          <TableCell>
                            {invoice.category?.name ?? "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmt.date(invoice.invoiceDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-medium">
                              {formatCurrency(Number(invoice.total))}
                            </div>
                            {paidAmount > 0 && balance > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                Bal: {formatCurrency(balance)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                STATUS_VARIANT[invoice.status] ?? "outline"
                              }
                            >
                              {invoice.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {invoice.paidAt
                              ? fmt.dateTimeShort(invoice.paidAt)
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <InvoiceFilePreview
                              invoiceId={invoice.id}
                              fileUrl={invoice.fileUrl}
                              compact
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              <Button
                                size="sm"
                                variant={
                                  invoice.status === "NEEDS_REVIEW" ||
                                  invoice.status === "PROCESSING"
                                    ? "default"
                                    : "outline"
                                }
                                className="h-8 px-2.5 text-xs"
                                nativeButton={false}
                                render={
                                  <Link href={`/invoices/${invoice.id}/review`} />
                                }
                              >
                                {invoice.status === "NEEDS_REVIEW" ||
                                invoice.status === "PROCESSING"
                                  ? "Review"
                                  : "Edit"}
                              </Button>
                              <InvoicePaymentControls
                                invoiceId={invoice.id}
                                status={invoice.status}
                                paidAt={invoice.paidAt?.toISOString() ?? null}
                                invoiceNumber={invoice.invoiceNumber}
                                vendorName={invoice.vendor.name}
                                categoryName={invoice.category?.name ?? null}
                                total={Number(invoice.total)}
                                paidAmount={paidAmount}
                                compact
                              />
                              {(!isStaff || invoice.uploadedById === session.user.id || userProjectIds.has(invoice.projectId)) && (
                                <InvoiceDeleteButton
                                  invoiceId={invoice.id}
                                  invoiceNumber={invoice.invoiceNumber}
                                  vendorName={invoice.vendor.name}
                                  className="h-8 w-8"
                                />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
