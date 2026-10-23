import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { summarise } from "@/lib/invoices/ageing";
import { todayIn } from "@/lib/invoices/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendor statement" };

type Props = { params: Promise<{ id: string }> };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCESSING: "outline",
  NEEDS_REVIEW: "secondary",
  UNPAID: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

/** One supplier: how much you have bought from them, paid them, and still owe them, and every invoice behind those numbers. */
export default async function VendorPage({ params }: Props) {
  const { id } = await params;
  const { db } = await pageOrg();
  const fmt = await getFormat();
  const money = (n: number) => fmt.money(n, 2);

  const vendor = await db.vendor.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: { project: { select: { name: true } }, payments: { select: { amount: true } } },
      },
    },
  });
  if (!vendor) notFound();

  const confirmed = vendor.invoices.filter((i) => i.status !== "NEEDS_REVIEW" && i.status !== "PROCESSING");
  const rows = confirmed.map((i) => {
    const total = Number(i.total);
    const paid = i.payments.reduce((s, p) => s + Number(p.amount), 0);
    return { i, total, paid, balance: Math.max(0, total - paid) };
  });
  const invoiced = rows.reduce((s, r) => s + r.total, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  const owed = rows.reduce((s, r) => s + r.balance, 0);
  const ageing = summarise(
    rows.map((r) => ({ id: r.i.id, invoiceNumber: r.i.invoiceNumber, vendorName: vendor.name, projectName: r.i.project.name, total: r.total, paid: r.paid, dueDate: r.i.dueDate })),
    todayIn(fmt.format.timeZone),
  );
  const drafts = vendor.invoices.length - confirmed.length;

  const stat = (label: string, value: string, tone = "") => (
    <Card>
      <CardHeader className="gap-1 p-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-xl tabular-nums ${tone}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <Link href="/vendors" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> All vendors
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{vendor.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {[vendor.gstin && `GSTIN ${vendor.gstin}`, vendor.contact, vendor.address].filter(Boolean).join(" · ") || "No contact details saved."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Invoiced", money(invoiced))}
        {stat("Paid", money(paid), "text-emerald-600")}
        {stat("You owe", money(owed), owed > 0 ? "text-amber-600" : "")}
        {stat("Overdue", money(ageing.overdue.amountMinor / 100), ageing.overdue.count ? "text-red-600" : "")}
      </div>

      {owed > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">What you owe, by age</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 p-4 pt-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {ageing.buckets
              .filter((b) => b.count > 0)
              .map((b) => (
                <div key={b.key} className="flex justify-between gap-3">
                  <span>
                    {b.label} <span className="text-xs text-muted-foreground">({b.count})</span>
                  </span>
                  <span className="font-medium tabular-nums">{money(b.amountMinor / 100)}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices ({confirmed.length})</CardTitle>
          <CardDescription>
            Newest first.{drafts > 0 ? ` ${drafts} more ${drafts === 1 ? "is" : "are"} still waiting for review and not counted above.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No confirmed invoices from this vendor yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ i, total, paid: p, balance }) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">
                        <Link href={`/invoices/${i.id}`} className="underline-offset-4 hover:underline">
                          {i.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{i.project.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmt.date(i.invoiceDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">{i.dueDate ? fmt.date(i.dueDate) : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">{money(p)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(balance)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[i.status] ?? "outline"}>{i.status.replaceAll("_", " ")}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
