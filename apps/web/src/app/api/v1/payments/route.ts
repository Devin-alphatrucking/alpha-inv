import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";

export const runtime = "nodejs";

/** The latest payments (up to 100) and the totals the website's Payments page shows: paid so far, paid this month, still to pay. */
export const GET = route("/api/v1/payments", async (req) => {
  const me = await requireMobile(req);
  need(me, "payment:view");
  const db = dbFor(me.orgId);
  const where = { invoice: { is: invoiceAccessWhere(me) } };
  // Payment dates are calendar dates at midnight UTC, so "this month" starts on the 1st in the company's own time zone.
  const monthStart = new Date(`${todayIn(await companyTimeZone(me.orgId)).slice(0, 7)}-01T00:00:00.000Z`);

  const [payments, totals, month, payable] = await Promise.all([
    db.payment.findMany({
      where,
      select: { id: true, amount: true, paidOn: true, mode: true, reference: true, invoice: { select: { id: true, invoiceNumber: true, vendor: { select: { name: true } }, project: { select: { name: true } } } } },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.payment.aggregate({ where, _sum: { amount: true } }),
    db.payment.aggregate({ where: { ...where, paidOn: { gte: monthStart } }, _sum: { amount: true } }),
    db.invoice.findMany({ where: { ...invoiceAccessWhere(me), status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE", "PAID"] } }, select: { total: true, payments: { select: { amount: true } } } }),
  ]);
  const outstanding = payable.reduce((sum, i) => sum + Math.max(0, Number(i.total) - i.payments.reduce((v, p) => v + Number(p.amount), 0)), 0);
  return json({
    totals: { paid: Number(totals._sum.amount ?? 0).toFixed(2), paidThisMonth: Number(month._sum.amount ?? 0).toFixed(2), outstanding: outstanding.toFixed(2) },
    payments,
  });
});
