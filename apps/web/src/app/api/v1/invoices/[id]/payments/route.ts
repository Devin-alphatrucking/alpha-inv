import { json, need, readJson, requireMobile, route } from "@/lib/mobile/http";
import { recordPayment } from "@/lib/invoices/payments";

export const runtime = "nodejs";

/** POST { amount, paidOn: "2026-11-02", mode?, reference?, notes? }: records a payment against a confirmed invoice (same rules as the website). */
export const POST = route<{ params: Promise<{ id: string }> }>("/api/v1/invoices/[id]/payments", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "payment:create");
  const { id } = await ctx.params;
  const body = (await readJson(req)) as { amount?: unknown; paidOn?: unknown; mode?: unknown; reference?: unknown; notes?: unknown };
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const r = await recordPayment(
    { id: me.id, orgId: me.orgId, role: me.role },
    { invoiceId: id, amount: Number(body.amount), paidOn: text(body.paidOn) ?? "", mode: text(body.mode), reference: text(body.reference), notes: text(body.notes) },
  );
  return json({ ok: true, paymentId: r.paymentId, status: r.status, paid: r.paidAmount.toFixed(2), balance: r.balance.toFixed(2) }, 201);
});
