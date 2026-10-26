import { createHash } from "node:crypto";
import { scoped } from "@/lib/org/context";
import { isAppError } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { recordPayment, type PaymentUser } from "@/lib/invoices/payments";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { checkRun } from "@/lib/invoices/planner";

/**
 * Records several payments in one go (a "pay run" from the payment planner). Each invoice is paid through the same
 * function a single payment uses, in its own transaction: the balance is re-checked under a lock, the status is worked out
 * from the real total, and one that cannot be paid (already settled, no longer confirmed) is reported on its own line
 * without stopping the rest. Submitting the identical run twice within seconds is refused, so a double click cannot pay twice.
 */

export type RunLine = { invoiceId: string; invoiceNumber: string; ok: boolean; status?: string; error?: string };
export type PayRunResult = { ok: true; lines: RunLine[]; paid: number; failed: number; totalMinor: number } | { ok: false; error: string };

export async function recordPayRun(user: PaymentUser, input: unknown): Promise<PayRunResult> {
  const today = todayIn(await companyTimeZone(user.orgId));
  const checked = checkRun(input, today);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { items, paidOn, mode, reference } = checked.run;

  // The same run twice within 20 seconds is a double click, not two decisions.
  const fingerprint = createHash("sha256").update(JSON.stringify({ items, paidOn, mode, reference })).digest("hex");
  const twice = await hit(limitKey("payrun:same", `${user.id}:${fingerprint}`), 1, 20);
  if (!twice.allowed) return { ok: false, error: "This payment run was just submitted. Look at the list before sending it again." };
  const busy = await hit(limitKey("payrun:user", user.id), 30, 3600);
  if (!busy.allowed) return { ok: false, error: retryMessage(busy.retryAfterSeconds) };

  const numbers = new Map(
    (await scoped(user).invoice.findMany({ where: { id: { in: items.map((i) => i.invoiceId) } }, select: { id: true, invoiceNumber: true } })).map((r) => [r.id, r.invoiceNumber]),
  );

  const lines: RunLine[] = [];
  let totalMinor = 0;
  for (const item of items) {
    const invoiceNumber = numbers.get(item.invoiceId) ?? "unknown invoice";
    try {
      const r = await recordPayment(user, { invoiceId: item.invoiceId, amount: item.amount, paidOn, mode: mode || undefined, reference: reference || undefined, notes: "Paid in a payment run" });
      lines.push({ invoiceId: item.invoiceId, invoiceNumber, ok: true, status: r.status });
      totalMinor += Math.round(item.amount * 100);
    } catch (error) {
      lines.push({ invoiceId: item.invoiceId, invoiceNumber, ok: false, error: isAppError(error) ? error.message : "Could not record this payment." });
      if (!isAppError(error)) console.error("[pay run]", error instanceof Error ? error.message : error);
    }
  }
  const paid = lines.filter((l) => l.ok).length;
  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "PAY_RUN_RECORDED",
    module: "PAYMENT",
    details: { requested: items.length, paid, failed: lines.length - paid, totalMinor, reference: reference || null, paidOn },
  });
  return { ok: true, lines, paid, failed: lines.length - paid, totalMinor };
}
