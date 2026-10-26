// Delivery check and invoice-to-order matching rules. Pure functions, unit-tested (delivery-rules.test.ts).
import { cleanText, isYmd } from "@/lib/site/rules";

type Fail = { ok: false; error: string; field?: string };
const bad = (error: string, field?: string): Fail => ({ ok: false, error, field });
const chars = (s: string) => [...s].length;
const oneLine = (raw: unknown) => cleanText(raw).replace(/\s*\n\s*/g, " ");

/** "12.5" -> 12500 thousandths; blank means 0. Up to 3 decimals, at most 9,999,999. */
export function parseQuantityOrZero(raw: unknown): number | null {
  const t = String(raw ?? "").trim().replace(/,/g, "");
  if (t === "") return 0;
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(t)) return null;
  return Math.round(Number(t) * 1000);
}

// ---- a delivery

export type ReceiptLineInput = { orderLineId: string; quantityMilli: number; rejectedMilli: number; remark: string | null };
export type ReceiptInput = { receivedOn: string; challanNo: string | null; note: string | null; lines: ReceiptLineInput[] };

/** Checks what was typed for one delivery. `orderLineIds` are the lines of the order it is for. */
export function parseReceipt(raw: unknown, today: string, orderLineIds: string[]): { ok: true; value: ReceiptInput } | Fail {
  const i = (raw ?? {}) as Record<string, unknown>;
  const receivedOn = i.receivedOn === undefined || i.receivedOn === "" ? today : i.receivedOn;
  if (!isYmd(receivedOn) || receivedOn < "2000-01-01") return bad("Choose the day the delivery arrived.", "receivedOn");
  if (receivedOn > today) return bad("A delivery cannot be dated in the future.", "receivedOn");
  const challanNo = oneLine(i.challanNo);
  if (chars(challanNo) > 60) return bad("Keep the challan number under 60 characters.", "challanNo");
  const note = cleanText(i.note);
  if (chars(note) > 1000) return bad("Keep the note under 1000 characters.", "note");
  if (!Array.isArray(i.lines)) return bad("Enter what arrived.", "lines");

  const known = new Set(orderLineIds);
  const seen = new Set<string>();
  const lines: ReceiptLineInput[] = [];
  for (const [n, rawLine] of i.lines.entries()) {
    const l = (rawLine ?? {}) as Record<string, unknown>;
    const id = typeof l.orderLineId === "string" ? l.orderLineId : "";
    if (!known.has(id)) return bad(`Line ${n + 1} is not on this order.`, "lines");
    if (seen.has(id)) return bad(`Line ${n + 1} is entered twice.`, "lines");
    seen.add(id);
    const quantityMilli = parseQuantityOrZero(l.quantity);
    const rejectedMilli = parseQuantityOrZero(l.rejected);
    if (quantityMilli === null || rejectedMilli === null) return bad(`Line ${n + 1}: enter quantities as numbers, up to 3 decimals.`, "lines");
    const remark = oneLine(l.remark);
    if (chars(remark) > 200) return bad(`Line ${n + 1}: keep the remark under 200 characters.`, "lines");
    if (quantityMilli === 0 && rejectedMilli === 0) continue; // nothing of this item came
    lines.push({ orderLineId: id, quantityMilli, rejectedMilli, remark: remark || null });
  }
  if (lines.length === 0) return bad("Enter the quantity that arrived for at least one item.", "lines");
  return { ok: true, value: { receivedOn, challanNo: challanNo || null, note: note || null, lines } };
}

export type LineProgress = "NONE" | "PARTLY" | "FULL" | "OVER";
export type OrderProgress = "NOT_RECEIVED" | "PARTLY" | "RECEIVED";
export const PROGRESS_LABEL: Record<OrderProgress, string> = { NOT_RECEIVED: "Nothing received", PARTLY: "Part received", RECEIVED: "Fully received" };

export function lineProgress(orderedMilli: number, receivedMilli: number): LineProgress {
  if (receivedMilli <= 0) return "NONE";
  if (receivedMilli < orderedMilli) return "PARTLY";
  return receivedMilli > orderedMilli ? "OVER" : "FULL";
}

export function orderProgress(lines: { orderedMilli: number; receivedMilli: number }[]): OrderProgress {
  if (lines.length === 0 || lines.every((l) => l.receivedMilli <= 0)) return "NOT_RECEIVED";
  return lines.every((l) => l.receivedMilli >= l.orderedMilli) ? "RECEIVED" : "PARTLY";
}

// ---- matching an invoice to its order

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which order line an invoice line is for: same material, same words, or one name inside the other. null = not on the order. */
export function matchLine(inv: { description: string; materialId?: string | null }, orderLines: { id: string; description: string; materialId?: string | null }[]): string | null {
  if (inv.materialId) {
    const byMaterial = orderLines.find((o) => o.materialId && o.materialId === inv.materialId);
    if (byMaterial) return byMaterial.id;
  }
  const a = norm(inv.description);
  if (!a) return null;
  const exact = orderLines.find((o) => norm(o.description) === a);
  if (exact) return exact.id;
  const inside = orderLines.find((o) => {
    const b = norm(o.description);
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 5 && (long === short || long.includes(` ${short} `) || long.startsWith(`${short} `) || long.endsWith(` ${short}`));
  });
  return inside?.id ?? null;
}

export type MatchOrderLine = { id: string; description: string; unit: string; quantityMilli: number; rateMinor: number; materialId: string | null; receivedMilli: number };
export type MatchInvoiceLine = { description: string; quantityMilli: number; rateMinor: number; materialId: string | null };
export type Finding = { kind: "not_on_order" | "rate_higher" | "quantity_over_ordered" | "quantity_over_received" | "not_received" | "total_higher"; severity: "problem" | "note"; message: string; lineIndex?: number };
export type MatchResult = { status: "OK" | "CHECK" | "MISMATCH"; findings: Finding[] };

const TOL_MILLI = 1;
const money = (minor: number) => (minor / 100).toFixed(2);
const qty = (milli: number) => Number((milli / 1000).toFixed(3)).toString();

/**
 * Compares a bill with the order it is for and what actually arrived.
 * `invoicedBefore` is how much of each order line earlier bills (for the same order) already covered, by order line id.
 * A problem is something to settle before paying: not on the order, a higher rate, more than ordered or more than received.
 * A note is for information: nothing recorded as received yet.
 */
export function matchInvoice(input: {
  orderLines: MatchOrderLine[];
  orderSubtotalMinor: number;
  invoiceLines: MatchInvoiceLine[];
  invoiceSubtotalMinor: number;
  invoicedBefore: Record<string, number>;
  invoicedBeforeSubtotalMinor: number;
}): MatchResult {
  const findings: Finding[] = [];
  const running: Record<string, number> = { ...input.invoicedBefore };
  input.invoiceLines.forEach((line, index) => {
    const name = line.description.length > 40 ? `${line.description.slice(0, 40)}…` : line.description;
    const id = matchLine(line, input.orderLines);
    const ordered = id ? input.orderLines.find((o) => o.id === id) : undefined;
    if (!ordered) {
      findings.push({ kind: "not_on_order", severity: "problem", lineIndex: index, message: `"${name}" is not on the purchase order.` });
      return;
    }
    const rateTolerance = Math.max(1, Math.round(ordered.rateMinor * 0.01));
    if (line.rateMinor > ordered.rateMinor + rateTolerance) {
      findings.push({ kind: "rate_higher", severity: "problem", lineIndex: index, message: `"${name}": rate ${money(line.rateMinor)} is higher than the ordered rate ${money(ordered.rateMinor)}.` });
    }
    const cumulative = (running[ordered.id] ?? 0) + line.quantityMilli;
    running[ordered.id] = cumulative;
    if (cumulative > ordered.quantityMilli + TOL_MILLI) {
      findings.push({ kind: "quantity_over_ordered", severity: "problem", lineIndex: index, message: `"${name}": billed ${qty(cumulative)} ${ordered.unit} in total, but only ${qty(ordered.quantityMilli)} were ordered.` });
    } else if (ordered.receivedMilli <= 0) {
      findings.push({ kind: "not_received", severity: "note", lineIndex: index, message: `"${name}": no delivery has been recorded for this item yet.` });
    } else if (cumulative > ordered.receivedMilli + TOL_MILLI) {
      findings.push({ kind: "quantity_over_received", severity: "problem", lineIndex: index, message: `"${name}": billed ${qty(cumulative)} ${ordered.unit} in total, but only ${qty(ordered.receivedMilli)} were received.` });
    }
  });
  const totalTolerance = Math.max(500, Math.round(input.orderSubtotalMinor * 0.01));
  const billedSubtotal = input.invoicedBeforeSubtotalMinor + input.invoiceSubtotalMinor;
  if (billedSubtotal > input.orderSubtotalMinor + totalTolerance) {
    findings.push({ kind: "total_higher", severity: "problem", message: `Bills for this order add up to ${money(billedSubtotal)} before GST, more than the order's ${money(input.orderSubtotalMinor)}.` });
  }
  const status = findings.some((f) => f.severity === "problem") ? "MISMATCH" : findings.length > 0 ? "CHECK" : "OK";
  return { status, findings };
}

export const MATCH_LABEL: Record<MatchResult["status"], string> = { OK: "Matches the order", CHECK: "Check delivery", MISMATCH: "Does not match the order" };
