// Purchase rules (material requests and purchase orders). Pure functions, unit-tested (rules.test.ts).
import { cleanText, isYmd } from "@/lib/site/rules";

export const MAX_LINES = 60;
export const LIMITS = { description: 200, unit: 12, note: 1000, address: 300, terms: 200, reason: 300 } as const;

type Fail = { ok: false; error: string; field?: string };
const bad = (error: string, field?: string): Fail => ({ ok: false, error, field });
const chars = (s: string) => [...s].length;
const oneLine = (raw: unknown) => cleanText(raw).replace(/\s*\n\s*/g, " ");

// ---- numbers (kept as whole milli-units and paise so nothing is lost to floating point)

/** "12.5" -> 12500 (thousandths). Up to 3 decimals, more than 0 and at most 9,999,999. */
export function parseQuantity(raw: unknown): number | null {
  const t = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(t)) return null;
  const milli = Math.round(Number(t) * 1000);
  return milli > 0 ? milli : null;
}

/** "1250.50" -> 125050 (paise). Up to 2 decimals, more than 0 and at most 99,999,999.99. */
export function parseMoney(raw: unknown): number | null {
  const t = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const minor = Math.round(Number(t) * 100);
  return minor > 0 ? minor : null;
}

/** GST rate in percent, 0 to 40 with up to 2 decimals -> hundredths of a percent (18 -> 1800). */
export function parseGst(raw: unknown): number | null {
  const t = String(raw ?? "").trim();
  if (t === "") return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 4000 ? bps : null;
}

export const milliToString = (milli: number) => (milli / 1000).toFixed(3);
export const minorToString = (minor: number) => (minor / 100).toFixed(2);

// ---- lines

export type RequestLineInput = { description: string; unit: string; quantityMilli: number; materialId: string | null };
export type OrderLineInput = RequestLineInput & { rateMinor: number; gstBps: number };

function parseLine(raw: unknown, index: number, withRate: boolean): { ok: true; value: OrderLineInput } | Fail {
  const l = (raw ?? {}) as Record<string, unknown>;
  const n = index + 1;
  const description = oneLine(l.description);
  if (chars(description) < 2) return bad(`Line ${n}: say what the item is.`, "lines");
  if (chars(description) > LIMITS.description) return bad(`Line ${n}: keep the item under ${LIMITS.description} characters.`, "lines");
  const unit = oneLine(l.unit).toUpperCase();
  if (unit === "" || chars(unit) > LIMITS.unit) return bad(`Line ${n}: give a unit such as BAG, KG or NOS.`, "lines");
  const quantityMilli = parseQuantity(l.quantity);
  if (quantityMilli === null) return bad(`Line ${n}: enter a quantity above 0 (up to 3 decimals).`, "lines");
  const materialId = typeof l.materialId === "string" && l.materialId.trim() ? l.materialId.trim() : null;
  let rateMinor = 0;
  let gstBps = 0;
  if (withRate) {
    const rate = parseMoney(l.rate);
    if (rate === null) return bad(`Line ${n}: enter a rate above 0 (up to 2 decimals).`, "lines");
    const gst = parseGst(l.gstPercent);
    if (gst === null) return bad(`Line ${n}: GST must be between 0 and 40 percent.`, "lines");
    rateMinor = rate;
    gstBps = gst;
  }
  return { ok: true, value: { description, unit, quantityMilli, materialId, rateMinor, gstBps } };
}

function parseLines(raw: unknown, withRate: boolean): { ok: true; value: OrderLineInput[] } | Fail {
  if (!Array.isArray(raw) || raw.length === 0) return bad("Add at least one item.", "lines");
  if (raw.length > MAX_LINES) return bad(`At most ${MAX_LINES} items on one document.`, "lines");
  const out: OrderLineInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = parseLine(raw[i], i, withRate);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

// ---- totals

export type LineAmount = { amountMinor: number; gstMinor: number; totalMinor: number };

/** Amount = quantity x rate, GST on that amount, each rounded to the paisa. */
export function lineAmount(quantityMilli: number, rateMinor: number, gstBps: number): LineAmount {
  const amountMinor = Math.round((quantityMilli * rateMinor) / 1000);
  const gstMinor = Math.round((amountMinor * gstBps) / 10000);
  return { amountMinor, gstMinor, totalMinor: amountMinor + gstMinor };
}

export function orderTotals(lines: { quantityMilli: number; rateMinor: number; gstBps: number }[]) {
  let subtotalMinor = 0;
  let gstMinor = 0;
  for (const l of lines) {
    const a = lineAmount(l.quantityMilli, l.rateMinor, l.gstBps);
    subtotalMinor += a.amountMinor;
    gstMinor += a.gstMinor;
  }
  return { subtotalMinor, gstMinor, totalMinor: subtotalMinor + gstMinor };
}

// ---- material request

export type RequestInput = { neededBy: string | null; note: string | null; lines: RequestLineInput[] };

export function parseRequest(raw: unknown, today: string): { ok: true; value: RequestInput } | Fail {
  const i = (raw ?? {}) as Record<string, unknown>;
  let neededBy: string | null = null;
  if (i.neededBy !== null && i.neededBy !== undefined && String(i.neededBy).trim() !== "") {
    if (!isYmd(i.neededBy)) return bad("Choose a valid date for when it is needed.", "neededBy");
    if (i.neededBy < today) return bad("The needed-by date cannot be in the past.", "neededBy");
    neededBy = i.neededBy;
  }
  const note = cleanText(i.note);
  if (chars(note) > LIMITS.note) return bad(`Keep the note under ${LIMITS.note} characters.`, "note");
  const lines = parseLines(i.lines, false);
  if (!lines.ok) return lines;
  return { ok: true, value: { neededBy, note: note || null, lines: lines.value.map(({ description, unit, quantityMilli, materialId }) => ({ description, unit, quantityMilli, materialId })) } };
}

export type RequestState = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "ORDERED" | "CANCELLED";
export type RequestAction = "edit" | "submit" | "withdraw" | "approve" | "reject" | "cancel" | "order";

export const REQUEST_LABEL: Record<RequestState, string> = { DRAFT: "Draft", SUBMITTED: "Waiting for approval", APPROVED: "Approved", REJECTED: "Rejected", ORDERED: "Ordered", CANCELLED: "Cancelled" };

/**
 * What this person may do with a request. The person who wrote it can edit a draft, send it for approval, take it back and cancel it.
 * An approver approves or rejects (not their own request, unless they are an administrator). The purchase officer turns an approved one into an order.
 */
export function requestActions(status: RequestState, who: { isOwner: boolean; canWrite: boolean; canApprove: boolean; isAdmin: boolean; canOrder: boolean }): RequestAction[] {
  const own = who.isOwner && who.canWrite;
  const out: RequestAction[] = [];
  switch (status) {
    case "DRAFT":
      if (own || who.isAdmin) out.push("edit", "submit", "cancel");
      break;
    case "SUBMITTED":
      if (own) out.push("withdraw");
      if (who.canApprove && (!who.isOwner || who.isAdmin)) out.push("approve", "reject");
      if (own || who.canApprove) out.push("cancel");
      break;
    case "APPROVED":
      if (who.canOrder) out.push("order");
      if (own || who.canApprove) out.push("cancel");
      break;
    default:
      break;
  }
  return out;
}

export function parseDecision(approve: boolean, noteRaw: unknown): { ok: true; note: string | null } | Fail {
  const note = cleanText(noteRaw);
  if (chars(note) > LIMITS.reason) return bad(`Keep the note under ${LIMITS.reason} characters.`, "note");
  if (!approve && chars(note) < 3) return bad("Say why it is rejected so the engineer knows what to change.", "note");
  return { ok: true, note: note || null };
}

// ---- purchase order

export type OrderInput = { vendorId: string; orderDate: string; deliveryDate: string | null; deliveryAddress: string | null; paymentTerms: string | null; note: string | null; lines: OrderLineInput[] };

export function parseOrder(raw: unknown, today: string): { ok: true; value: OrderInput } | Fail {
  const i = (raw ?? {}) as Record<string, unknown>;
  const vendorId = typeof i.vendorId === "string" ? i.vendorId.trim() : "";
  if (!vendorId) return bad("Choose the supplier.", "vendorId");
  const orderDate = i.orderDate === undefined || i.orderDate === "" ? today : i.orderDate;
  if (!isYmd(orderDate) || orderDate < "2000-01-01") return bad("Choose a valid order date.", "orderDate");
  let deliveryDate: string | null = null;
  if (i.deliveryDate !== null && i.deliveryDate !== undefined && String(i.deliveryDate).trim() !== "") {
    if (!isYmd(i.deliveryDate)) return bad("Choose a valid delivery date.", "deliveryDate");
    if (i.deliveryDate < orderDate) return bad("The delivery date cannot be before the order date.", "deliveryDate");
    deliveryDate = i.deliveryDate;
  }
  const text = (v: unknown, max: number, field: string, label: string): { ok: true; value: string | null } | Fail => {
    const t = field === "note" ? cleanText(v) : oneLine(v);
    if (chars(t) > max) return bad(`Keep ${label} under ${max} characters.`, field);
    return { ok: true, value: t || null };
  };
  const address = text(i.deliveryAddress, LIMITS.address, "deliveryAddress", "the delivery address");
  if (!address.ok) return address;
  const terms = text(i.paymentTerms, LIMITS.terms, "paymentTerms", "the payment terms");
  if (!terms.ok) return terms;
  const note = text(i.note, LIMITS.note, "note", "the note");
  if (!note.ok) return note;
  const lines = parseLines(i.lines, true);
  if (!lines.ok) return lines;
  return { ok: true, value: { vendorId, orderDate, deliveryDate, deliveryAddress: address.value, paymentTerms: terms.value, note: note.value, lines: lines.value } };
}

export type OrderState = "DRAFT" | "SENT" | "PART_DELIVERED" | "DELIVERED" | "CLOSED" | "CANCELLED";
export type OrderAction = "edit" | "send" | "cancel" | "close";
export const ORDER_LABEL: Record<OrderState, string> = { DRAFT: "Draft", SENT: "Sent to supplier", PART_DELIVERED: "Part delivered", DELIVERED: "Delivered", CLOSED: "Closed", CANCELLED: "Cancelled" };

/** Statuses of an order the supplier has (goods can arrive, bills can be linked). The delivery check moves it between the first three. */
export const OPEN_FOR_GOODS: OrderState[] = ["SENT", "PART_DELIVERED", "DELIVERED"];
export const isOpenForGoods = (status: string) => (OPEN_FOR_GOODS as string[]).includes(status);

/** What the order's status should be once goods have arrived (or been removed again): nothing yet, some, or all. */
export const statusForProgress = (progress: "NOT_RECEIVED" | "PARTLY" | "RECEIVED"): "SENT" | "PART_DELIVERED" | "DELIVERED" =>
  progress === "RECEIVED" ? "DELIVERED" : progress === "PARTLY" ? "PART_DELIVERED" : "SENT";

/**
 * A draft can be changed and sent; a draft or an order nothing has arrived for can be cancelled (with a reason).
 * Once goods have arrived it can only be closed: when everything came, or short (the rest is not coming), with a reason.
 */
export function orderActions(status: OrderState, canWrite: boolean): OrderAction[] {
  if (!canWrite) return [];
  if (status === "DRAFT") return ["edit", "send", "cancel"];
  if (status === "SENT") return ["cancel"];
  if (status === "PART_DELIVERED" || status === "DELIVERED") return ["close"];
  return [];
}

/** Closing short (part delivered) needs a reason; closing a fully delivered order does not. */
export function parseClose(short: boolean, raw: unknown): { ok: true; reason: string | null } | Fail {
  const reason = oneLine(raw);
  if (chars(reason) > LIMITS.reason) return bad(`Keep the reason under ${LIMITS.reason} characters.`, "reason");
  if (short && chars(reason) < 3) return bad("Say why the rest is not coming.", "reason");
  return { ok: true, reason: reason || null };
}

export function parseCancelReason(raw: unknown): { ok: true; reason: string } | Fail {
  const reason = oneLine(raw);
  if (chars(reason) < 3) return bad("Say why it is cancelled.", "reason");
  if (chars(reason) > LIMITS.reason) return bad(`Keep the reason under ${LIMITS.reason} characters.`, "reason");
  return { ok: true, reason };
}

/** "PO-2026-0007". */
export const documentNumber = (kind: "MR" | "PO", year: number, n: number) => `${kind}-${year}-${String(n).padStart(4, "0")}`;
