import { hasPermission } from "@/lib/roles";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
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
import { projectAccessWhere } from "@/lib/projects/access";
import { ProjectNoteForm } from "./note-form";
import { BudgetMeter } from "@/components/budget-meter";
import { getFormat } from "@/lib/brand/brand";

type PageProps = { params: Promise<{ id: string }> };

function statusVariant(status: string) {
  if (status === "COMPLETED") return "default" as const;
  if (status === "ARCHIVED") return "secondary" as const;
  return "outline" as const;
}

const INVOICE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCESSING: "outline",
  NEEDS_REVIEW: "secondary",
  UNPAID: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { db, user, session } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 0) => fmt.money(value, maxFraction);

  const project = await db.project.findFirst({
    where: {
      id,
      ...projectAccessWhere(user),
    },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true } } },
      },
      invoices: {
        orderBy: { invoiceDate: "desc" },
        include: {
          vendor: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          payments: {
            orderBy: { paidOn: "desc" },
            include: { paidBy: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  if (!project) notFound();

  const invoiceRows = project.invoices.map((invoice) => {
    const t = Number(invoice.total);
    const p = invoice.payments.reduce((s, pay) => s + Number(pay.amount), 0);
    return { invoice, paid: p, balance: Math.max(0, t - p) };
  });
  // Same rule as the projects list and the dashboard: invoices still being read or reviewed are not counted yet, and what is
  // pending is the sum of each invoice's own balance (an overpaid invoice never reduces another one's).
  const counted = invoiceRows.filter((row) => row.invoice.status !== "PROCESSING" && row.invoice.status !== "NEEDS_REVIEW");
  const total = counted.reduce((sum, row) => sum + Number(row.invoice.total), 0);
  const paid = counted.reduce((sum, row) => sum + row.paid, 0);
  const pending = counted.reduce((sum, row) => sum + row.balance, 0);

  const payments = project.invoices.flatMap((invoice) =>
    invoice.payments.map((payment) => ({
      ...payment,
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      vendorName: invoice.vendor.name,
    }))
  );
  payments.sort((a, b) => b.paidOn.getTime() - a.paidOn.getTime());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <Badge variant={statusVariant(project.status)}>{project.status}</Badge>
          </div>
          {project.address && (
            <p className="mt-1 text-sm text-muted-foreground">{project.address}</p>
          )}
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          Back to projects
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Invoiced</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatCurrency(total)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paid</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-600">{formatCurrency(paid)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-amber-600">{formatCurrency(pending)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {project.budget && hasPermission(session.user.role, "budget:view") ? (
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Budget</CardDescription>
            <CardTitle className="text-base font-medium">How much of the {formatCurrency(Number(project.budget))} budget is used</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetMeter spent={total} budget={Number(project.budget)} money={(n) => formatCurrency(n)} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoices ({invoiceRows.length})</CardTitle>
              <CardDescription>Invoices linked to this project</CardDescription>
            </CardHeader>
            <CardContent>
              {invoiceRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No invoices linked to this project yet.
                </p>
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {invoiceRows.map(({ invoice, paid: p, balance }) => (
                      <Link
                        key={invoice.id}
                        href={`/invoices/${invoice.id}/review`}
                        className="block rounded-xl border bg-card p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{invoice.invoiceNumber}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {invoice.vendor.name}
                            </p>
                          </div>
                          <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] ?? "outline"}>
                            {invoice.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {fmt.date(invoice.invoiceDate)}
                          </span>
                          <span className="font-medium">{formatCurrency(Number(invoice.total))}</span>
                        </div>
                        {p > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Paid {formatCurrency(p)} · Balance {formatCurrency(balance)}
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoiceRows.map(({ invoice, paid: p, balance }) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium">
                              <Link href={`/invoices/${invoice.id}/review`} className="hover:underline underline-offset-4">
                                {invoice.invoiceNumber}
                              </Link>
                            </TableCell>
                            <TableCell>{invoice.vendor.name}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              {fmt.date(invoice.invoiceDate)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] ?? "outline"}>
                                {invoice.status.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(Number(invoice.total))}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-600">{formatCurrency(p)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-600">{formatCurrency(balance)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments ({payments.length})</CardTitle>
              <CardDescription>Payment history across this project</CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No payments recorded for this project yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {payments.slice(0, 25).map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/invoices/${payment.invoiceId}/review`}
                          className="font-medium hover:underline underline-offset-4"
                        >
                          {payment.invoiceNumber}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {fmt.date(payment.paidOn)} · {payment.mode ?? "Other"}
                          {payment.paidBy ? ` · by ${payment.paidBy.name}` : ""}
                        </span>
                      </div>
                      <span className="font-semibold tabular-nums text-emerald-600">
                        {formatCurrency(Number(payment.amount), 2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Team ({project.assignments.length})</CardTitle>
              <CardDescription>Staff assigned to this project</CardDescription>
            </CardHeader>
            <CardContent>
              {project.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No staff assigned.</p>
              ) : (
                <div className="space-y-2">
                  {project.assignments.map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{assignment.user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{assignment.user.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>Project notes and updates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProjectNoteForm projectId={project.id} />
              {project.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {project.notes.map((note) => (
                    <div key={note.id} className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-sm">{note.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {note.user.name} · {fmt.dateTime(note.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
