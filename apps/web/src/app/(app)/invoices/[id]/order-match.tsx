import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { getFormat } from "@/lib/brand/brand";
import { invoiceMatch } from "@/lib/flows/delivery";
import { MATCH_LABEL, PROGRESS_LABEL } from "@/lib/purchase/delivery-rules";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectUser } from "@/lib/projects/access";
import { OrderLink } from "./order-link";

/** Does this bill agree with the purchase order and with what actually arrived? Shown to people who may see orders. */
export async function InvoiceOrderMatch({ invoiceId, user }: { invoiceId: string; user: ProjectUser }) {
  const m = await invoiceMatch(user, invoiceId);
  if (!m) return null;
  if (!m.linked && m.candidates.length === 0) return null; // nothing to link to, nothing linked: stay out of the way
  const fmt = await getFormat();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Purchase order check</CardTitle>
        <CardDescription>Compares this bill with what was ordered and what arrived on site.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {m.linked && m.result ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {m.result.status === "OK" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : m.result.status === "CHECK" ? <Info className="size-4" aria-hidden /> : <AlertTriangle className="size-4 text-destructive" aria-hidden />}
              <span className="font-medium">{MATCH_LABEL[m.result.status]}</span>
              <span className="text-muted-foreground">
                · <Link href={`/purchase/orders/${m.linked.orderId}`} className="underline underline-offset-2">{m.linked.number}</Link> · {PROGRESS_LABEL[m.result.progress].toLowerCase()}
              </span>
            </p>
            {m.result.findings.length > 0 && (
              <ul className="grid gap-1.5 text-sm" aria-label="What does not match">
                {m.result.findings.map((f, i) => (
                  <li key={i} className={f.severity === "problem" ? "text-destructive" : "text-muted-foreground"}>{f.severity === "problem" ? "Problem: " : "Note: "}{f.message}</li>
                ))}
              </ul>
            )}
            {m.result.status === "MISMATCH" && <p className="text-xs text-muted-foreground">Settle these with the supplier before paying. Payment is not blocked.</p>}
            {m.canLink && <OrderLink invoiceId={m.invoiceId} linkedOrderId={m.linked.orderId} candidates={[]} />}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">This supplier has orders on this project. If this bill is for one of them, link it to check the quantities and rates.</p>
            {m.canLink ? (
              <OrderLink invoiceId={m.invoiceId} linkedOrderId={null} candidates={m.candidates.map((c) => ({ id: c.id, label: `${c.number} · ${fmt.money(c.totalMinor / 100, 2)}` }))} />
            ) : (
              <ul className="text-sm">{m.candidates.map((c) => <li key={c.id}>{c.number}</li>)}</ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
