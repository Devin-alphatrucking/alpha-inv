import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { getInvoice } from "@/lib/flows/sales";
import { companyToday } from "@/lib/flows/site";
import { hasPermission } from "@/lib/roles";
import { GST_STATES } from "@/lib/gst/gstin";
import { amountInWords } from "@/lib/sales/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CancelButton, PrintButton } from "./invoice-actions";
import { ReceiptsPanel } from "./receipts-panel";

const STATUS_LABEL: Record<string, string> = { ISSUED: "Unpaid", PARTIALLY_PAID: "Part paid", PAID: "Paid", CANCELLED: "Cancelled" };

export default async function SalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await pageOrg();
  const fmt = await getFormat();
  const r = await getInvoice(user, id);
  if (!r.ok) notFound();
  const { invoice: i, profile } = r;
  const canWrite = hasPermission(user.role, "sales:write");
  const today = await companyToday(user.orgId);
  const state = (code: string) => `${code} - ${GST_STATES[code] ?? code}`;
  const intra = i.supply === "intra";
  const m = (v: number) => fmt.money(v, 2);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" nativeButton={false} render={<Link href="/sales" />}>
          <ArrowLeft className="size-4" /> All invoices
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn(i.status === "PAID" ? "bg-emerald-100 text-emerald-700" : i.status === "CANCELLED" ? "bg-muted text-muted-foreground" : i.overdue ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-800")}>
            {i.overdue ? "Overdue" : STATUS_LABEL[i.status]}
          </Badge>
          <PrintButton />
          {canWrite && i.status !== "CANCELLED" && i.receipts.length === 0 && <CancelButton id={i.id} number={i.number} />}
        </div>
      </div>

      <article className="relative overflow-hidden rounded-2xl border bg-card p-5 text-sm shadow-sm sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {i.status === "CANCELLED" && (
          <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-destructive/10 sm:text-9xl">Cancelled</p>
        )}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-0.5">
            <p className="text-lg font-semibold">{profile?.legalName ?? "Your company"}</p>
            {profile?.address && <p className="max-w-xs whitespace-pre-line text-muted-foreground">{profile.address}</p>}
            {profile?.gstin && <p>GSTIN: <span className="font-medium">{profile.gstin}</span></p>}
            {profile && <p className="text-muted-foreground">State: {state(profile.stateCode)}</p>}
            {(profile?.phone || profile?.email) && <p className="text-muted-foreground">{[profile.phone, profile.email].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="space-y-0.5 text-right">
            <p className="text-xl font-semibold tracking-tight">TAX INVOICE</p>
            <p>No: <span className="font-medium">{i.number}</span></p>
            <p>Date: {i.invoiceDate}</p>
            {i.dueDate && <p>Due: {i.dueDate}</p>}
          </div>
        </header>

        <section className="grid gap-4 border-b py-4 sm:grid-cols-2">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bill to</p>
            <p className="font-medium">{i.customer.name}</p>
            {i.customer.address && <p className="whitespace-pre-line text-muted-foreground">{i.customer.address}</p>}
            {i.customer.gstin && <p>GSTIN: <span className="font-medium">{i.customer.gstin}</span></p>}
          </div>
          <div className="space-y-0.5 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Place of supply</p>
            <p className="font-medium">{state(i.placeOfSupply)}</p>
            <p className="text-muted-foreground">{intra ? "Intra-state supply (CGST + SGST)" : "Inter-state supply (IGST)"}</p>
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="my-4 w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Description</th>
                <th className="py-2 pr-2">HSN/SAC</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 pr-2 text-right">Rate</th>
                <th className="py-2 pr-2 text-right">Disc %</th>
                <th className="py-2 pr-2 text-right">Taxable</th>
                <th className="py-2 pr-2 text-right">GST %</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {i.lines.map((l) => (
                <tr key={l.position} className="border-b align-top">
                  <td className="py-2 pr-2">{l.position}</td>
                  <td className="py-2 pr-2">{l.description}</td>
                  <td className="py-2 pr-2">{l.hsnSac ?? "-"}</td>
                  <td className="py-2 pr-2 text-right">{l.quantity} {l.unit}</td>
                  <td className="py-2 pr-2 text-right">{m(l.rate)}</td>
                  <td className="py-2 pr-2 text-right">{l.discountPercent || "-"}</td>
                  <td className="py-2 pr-2 text-right">{m(l.taxable)}</td>
                  <td className="py-2 pr-2 text-right">{l.gstPercent}</td>
                  <td className="py-2 text-right">{m(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-muted-foreground">{amountInWords(i.total)}</p>
            {i.notes && <p className="whitespace-pre-line">{i.notes}</p>}
            {profile?.bankDetails && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank details</p>
                <p className="whitespace-pre-line">{profile.bankDetails}</p>
              </div>
            )}
          </div>
          <dl className="grid gap-1.5 sm:justify-self-end sm:text-right">
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Taxable value</dt><dd>{m(i.taxable)}</dd></div>
            {intra ? (
              <>
                <div className="flex justify-between gap-8"><dt className="text-muted-foreground">CGST</dt><dd>{m(i.cgst)}</dd></div>
                <div className="flex justify-between gap-8"><dt className="text-muted-foreground">SGST</dt><dd>{m(i.sgst)}</dd></div>
              </>
            ) : (
              <div className="flex justify-between gap-8"><dt className="text-muted-foreground">IGST</dt><dd>{m(i.igst)}</dd></div>
            )}
            {i.roundOff !== 0 && <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Round off</dt><dd>{m(i.roundOff)}</dd></div>}
            <div className="flex justify-between gap-8 border-t pt-2 text-base font-semibold"><dt>Total</dt><dd>{m(i.total)}</dd></div>
            {i.received > 0 && <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Received</dt><dd>{m(i.received)}</dd></div>}
            {i.status !== "CANCELLED" && i.balance > 0 && <div className="flex justify-between gap-8 font-medium"><dt>Balance due</dt><dd>{m(i.balance)}</dd></div>}
          </dl>
        </section>

        {profile?.terms && (
          <footer className="mt-6 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Terms</p>
            <p className="whitespace-pre-line text-muted-foreground">{profile.terms}</p>
          </footer>
        )}
      </article>

      <ReceiptsPanel invoiceId={i.id} receipts={i.receipts} balance={i.balance} today={today} canWrite={canWrite} cancelled={i.status === "CANCELLED"} />
    </div>
  );
}
