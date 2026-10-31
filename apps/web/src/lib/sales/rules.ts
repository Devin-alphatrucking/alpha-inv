// Rules for GST tax invoices a company issues (the Sales add-on). Pure functions, unit-tested (rules.test.ts).
// Money is worked out in whole paise (integers), so totals never drift by a paisa.

export const toPaise = (n: number) => Math.round((n + Number.EPSILON) * 100);
export const fromPaise = (p: number) => p / 100;

/** The tax rates GST uses (percent). A line may use any of these. */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

export type LineInput = {
  description: string;
  hsnSac?: string | null;
  quantity: number;
  unit: string;
  rate: number;
  discountPercent?: number;
  gstPercent: number;
};

export type LineResult = LineInput & { discountPercent: number; taxable: number; taxAmount: number; lineTotal: number };

export type InvoiceTotals = {
  /** "intra": seller and place of supply are in the same state (CGST + SGST); "inter": different states (IGST). */
  supply: "intra" | "inter";
  lines: LineResult[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Added so the total is a whole rupee (can be negative). */
  roundOff: number;
  total: number;
};

export type Problem = { ok: false; error: string };

/** Works out every line and the invoice totals. Returns a problem in plain words when a line cannot be priced. */
export function computeInvoice(input: { lines: LineInput[]; sellerState: string; placeOfSupply: string }): ({ ok: true } & InvoiceTotals) | Problem {
  if (!/^\d{2}$/.test(input.sellerState)) return { ok: false, error: "Your company's state is not set. Add it under Sales settings." };
  if (!/^\d{2}$/.test(input.placeOfSupply)) return { ok: false, error: "Choose the place of supply (the customer's state)." };
  if (input.lines.length === 0) return { ok: false, error: "Add at least one item." };
  if (input.lines.length > 200) return { ok: false, error: "An invoice can have up to 200 items." };
  const supply = input.sellerState === input.placeOfSupply ? "intra" : "inter";

  let taxableP = 0;
  let cgstP = 0;
  let sgstP = 0;
  let igstP = 0;
  const lines: LineResult[] = [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    if (!l.description.trim()) return { ok: false, error: `Item ${n}: write what was sold.` };
    if (!l.unit.trim()) return { ok: false, error: `Item ${n}: write the unit (Nos, Kg, Bag...).` };
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) return { ok: false, error: `Item ${n}: the quantity must be more than zero.` };
    if (!Number.isFinite(l.rate)) return { ok: false, error: `Item ${n}: enter the rate.` };
    if (l.rate < 0) return { ok: false, error: `Item ${n}: the rate cannot be negative.` };
    const discount = l.discountPercent ?? 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return { ok: false, error: `Item ${n}: the discount must be between 0 and 100%.` };
    if (!Number.isFinite(l.gstPercent) || l.gstPercent < 0 || l.gstPercent > 40) return { ok: false, error: `Item ${n}: the GST rate must be between 0 and 40%.` };
    if (l.hsnSac && !/^\d{4,8}$/.test(l.hsnSac.trim())) return { ok: false, error: `Item ${n}: the HSN/SAC code is 4 to 8 digits.` };

    const grossP = Math.round(l.quantity * toPaise(l.rate));
    const taxable = grossP - Math.round((grossP * discount) / 100);
    const tax = Math.round((taxable * l.gstPercent) / 100);
    taxableP += taxable;
    if (supply === "intra") {
      const half = Math.round(tax / 2); // the two halves always add back to the line's tax
      cgstP += half;
      sgstP += tax - half;
    } else {
      igstP += tax;
    }
    lines.push({ ...l, hsnSac: l.hsnSac?.trim() || null, discountPercent: discount, taxable: fromPaise(taxable), taxAmount: fromPaise(tax), lineTotal: fromPaise(taxable + tax) });
  }

  const rawP = taxableP + cgstP + sgstP + igstP;
  const totalP = Math.round(rawP / 100) * 100; // to the nearest whole rupee, as invoices are usually written
  return { ok: true, supply, lines, taxable: fromPaise(taxableP), cgst: fromPaise(cgstP), sgst: fromPaise(sgstP), igst: fromPaise(igstP), roundOff: fromPaise(totalP - rawP), total: fromPaise(totalP) };
}

/** The financial year (1 April to 31 March) a date falls in: { start: 2026, label: "2026-27" }. Dates are calendar days ("2026-11-05"). */
export function financialYear(day: string): { start: number; label: string } {
  const [y, m] = day.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { start, label: `${start}-${String((start + 1) % 100).padStart(2, "0")}` };
}

/** INV/2026-27/0007 */
export const invoiceNumber = (prefix: string, fyLabel: string, seq: number) => `${prefix}/${fyLabel}/${String(seq).padStart(4, "0")}`;

/** The invoice prefix: letters and digits, up to 8 characters ("INV", "SAN"). */
export function cleanPrefix(raw: string): string | null {
  const p = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(p) ? p : null;
}

export type SalesStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/** Status from what has been received. A cancelled invoice stays cancelled. */
export function statusFromReceipts(total: number, received: number, cancelled: boolean): SalesStatus {
  if (cancelled) return "CANCELLED";
  const t = toPaise(total);
  const r = toPaise(received);
  if (r <= 0) return "ISSUED";
  return r >= t ? "PAID" : "PARTIALLY_PAID";
}

/** Whether an unpaid invoice is past its due date (both calendar days, "2026-11-05"). */
export const isOverdue = (dueDate: string | null, today: string, status: SalesStatus) => Boolean(dueDate) && dueDate! < today && (status === "ISSUED" || status === "PARTIALLY_PAID");

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** 123456.78 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Paise Seventy Eight Only" (Indian lakh and crore grouping). */
export function amountInWords(amount: number): string {
  const p = Math.abs(toPaise(amount));
  let rupees = Math.floor(p / 100);
  const paise = p % 100;
  const groups: [number, string][] = [[10_000_000, "Crore"], [100_000, "Lakh"], [1000, "Thousand"]];
  const words: string[] = [];
  for (const [size, name] of groups) {
    if (rupees >= size) {
      words.push(`${below1000(Math.floor(rupees / size)) || ""} ${name}`.trim());
      rupees %= size;
    }
  }
  if (rupees > 0) words.push(below1000(rupees));
  const rupeeText = words.length ? words.join(" ") : "Zero";
  return `Rupees ${rupeeText}${paise ? ` and Paise ${below1000(paise)}` : ""} Only`;
}

/** One cell of a CSV: quotes when needed, and text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== "number") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
