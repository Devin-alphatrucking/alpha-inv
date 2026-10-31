import Link from "next/link";
import { Plus } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { getProfile, listInvoices } from "@/lib/flows/sales";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/roles";

export const metadata = { title: "Sales invoices" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "ISSUED", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
  { value: "CANCELLED", label: "Cancelled" },
];

const STATUS_LABEL: Record<string, string> = { ISSUED: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid", CANCELLED: "Cancelled" };
const statusTone = (s: string, overdue: boolean) => (overdue ? "bg-destructive/10 text-destructive" : s === "PAID" ? "bg-emerald-100 text-emerald-700" : s === "CANCELLED" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800");

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q, status } = await searchParams;
  const { user } = await pageOrg();
  const fmt = await getFormat();
  const [list, profile] = await Promise.all([listInvoices(user, { q, status }), getProfile(user.orgId)]);
  const canWrite = hasPermission(user.role, "sales:write");
  if (!list.ok) return <p className="text-sm text-destructive">{list.error}</p>;
  const { invoices, totals } = list;
  const link = (s: string) => `/sales?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(q ? { q } : {}) }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales invoices</h1>
          <p className="text-sm text-muted-foreground">GST tax invoices you issue to your customers.</p>
        </div>
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/sales/new" />}>
            <Plus className="size-4" /> New invoice
          </Button>
        )}
      </div>

      {!profile && canWrite && (
        <Card className="border-amber-500/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">First, add your company details (name, address, GSTIN and state) so they print on every invoice and the right tax is worked out.</p>
            <Button variant="outline" nativeButton={false} render={<Link href="/sales/settings" />}>
              Add company details
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Billed", totals.billed, ""],
          ["Received", totals.received, ""],
          ["Still to receive", totals.outstanding, totals.outstanding > 0 ? "text-amber-700" : ""],
          ["Overdue", totals.overdue, totals.overdue > 0 ? "text-destructive" : ""],
        ].map(([label, value, tone]) => (
          <Card key={label as string} size="sm">
            <CardContent>
              <p className={cn("text-xl font-semibold tracking-tight", tone as string)}>{fmt.money(value as number, 2)}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action="/sales" className="flex-1 sm:max-w-xs">
          {status && <input type="hidden" name="status" value={status} />}
          <Input name="q" defaultValue={q ?? ""} placeholder="Search number or customer" aria-label="Search sales invoices" />
        </form>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link key={f.value} href={link(f.value)} className={cn("rounded-full border px-3 py-1.5 text-sm", (status ?? "") === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {invoices.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{q || status ? "No invoices match." : "No invoices yet. Use New invoice to issue your first one."}</p>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {invoices.map((i) => (
              <Link key={i.id} href={`/sales/${i.id}`} className="block space-y-1.5 rounded-xl border bg-card p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{i.customerName}</p>
                  <p className="text-sm font-semibold">{fmt.money(i.total, 2)}</p>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{i.number} · {i.invoiceDate}</span>
                  <Badge className={statusTone(i.status, i.overdue)}>{i.overdue ? "Overdue" : STATUS_LABEL[i.status]}</Badge>
                </div>
                {i.balance > 0 && <p className="text-xs text-muted-foreground">Balance {fmt.money(i.balance, 2)}{i.dueDate ? ` · due ${i.dueDate}` : ""}</p>}
              </Link>
            ))}
          </div>
          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link href={`/sales/${i.id}`} className="font-medium underline-offset-4 hover:underline">{i.number}</Link>
                      </TableCell>
                      <TableCell>{i.invoiceDate}</TableCell>
                      <TableCell>{i.customerName}</TableCell>
                      <TableCell className="text-right">{fmt.money(i.total, 2)}</TableCell>
                      <TableCell className="text-right">{i.balance > 0 ? fmt.money(i.balance, 2) : "-"}</TableCell>
                      <TableCell>
                        <Badge className={statusTone(i.status, i.overdue)}>{i.overdue ? "Overdue" : STATUS_LABEL[i.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
