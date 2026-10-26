// The payment planner: when money falls due, which bills to pay in a run, and the checks on a run before anything is saved.
// Pure functions, unit-tested (planner.test.ts). Amounts are whole paise/cents; "today" is the company's calendar date (YYYY-MM-DD).
import { owedInvoices, type Owed, type OwedInvoice } from "./ageing";
import { toMinor } from "./status";

export const WEEKS_SHOWN = 8;
export const MAX_RUN_ITEMS = 100;

/** Everything still owed, soonest-due first (overdue first, most overdue at the top; no due date last), then the bigger bill first. */
export function owedList(invoices: OwedInvoice[], today: string): Owed[] {
  return owedInvoices(invoices, today).sort((a, b) => {
    if (a.daysLate === null && b.daysLate === null) return b.balanceMinor - a.balanceMinor;
    if (a.daysLate === null) return 1;
    if (b.daysLate === null) return -1;
    return b.daysLate - a.daysLate || b.balanceMinor - a.balanceMinor;
  });
}

export type Week = { key: string; label: string; count: number; amountMinor: number };

/**
 * Money by when it falls due: overdue, then 8 weeks of 7 days starting today, then later, then no due date.
 * "This week" is today and the next 6 days (so a bill due today is in it).
 */
export function cashFlow(owed: Owed[]): Week[] {
  const out: Week[] = [{ key: "overdue", label: "Overdue", count: 0, amountMinor: 0 }];
  for (let i = 0; i < WEEKS_SHOWN; i++) out.push({ key: `w${i}`, label: i === 0 ? "This week" : i === 1 ? "Next week" : `In ${i} weeks`, count: 0, amountMinor: 0 });
  out.push({ key: "later", label: "Later", count: 0, amountMinor: 0 }, { key: "none", label: "No due date", count: 0, amountMinor: 0 });
  const find = (key: string) => out.find((w) => w.key === key)!;
  for (const o of owed) {
    let key: string;
    if (o.daysLate === null) key = "none";
    else if (o.daysLate > 0) key = "overdue";
    else {
      const ahead = -o.daysLate; // 0 = due today
      const week = Math.floor(ahead / 7);
      key = week < WEEKS_SHOWN ? `w${week}` : "later";
    }
    const w = find(key);
    w.count += 1;
    w.amountMinor += o.balanceMinor;
  }
  return out;
}

export type Preset = "overdue" | "week" | "fortnight" | "all" | "none";

/** The invoices a quick-pick button ticks: overdue; overdue plus due in the next 7 days; plus the next 14 days; everything; nothing. */
export function presetIds(owed: Pick<Owed, "id" | "daysLate">[], preset: Preset): string[] {
  const within = (days: number) => owed.filter((o) => o.daysLate !== null && o.daysLate >= -(days - 1)).map((o) => o.id);
  switch (preset) {
    case "overdue":
      return owed.filter((o) => o.daysLate !== null && o.daysLate > 0).map((o) => o.id);
    case "week":
      return within(7);
    case "fortnight":
      return within(14);
    case "all":
      return owed.map((o) => o.id);
    default:
      return [];
  }
}

/** A typed amount as paise, or an error: a positive number with at most 2 decimals, no more than the balance. */
export function parsePayAmount(raw: unknown, balanceMinor: number): { ok: true; minor: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter an amount such as 1250 or 1250.50." };
  const minor = toMinor(Number(text));
  if (minor <= 0) return { ok: false, error: "The amount must be more than zero." };
  if (minor > balanceMinor) return { ok: false, error: "That is more than the balance still owed." };
  return { ok: true, minor };
}

export type RunItem = { invoiceId: string; amount: number };
export type RunInput = { items: RunItem[]; paidOn: string; mode?: string; reference?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a pay run before any payment is saved: 1 to 100 distinct invoices with positive amounts, a real date that is not in the
 * future, and short mode/reference text. Returns the cleaned run or the first problem.
 */
export function checkRun(input: unknown, today: string): { ok: true; run: Required<Pick<RunInput, "items" | "paidOn">> & { mode: string; reference: string } } | { ok: false; error: string } {
  const i = (input ?? {}) as Partial<RunInput>;
  if (!Array.isArray(i.items) || i.items.length === 0) return { ok: false, error: "Tick at least one invoice to pay." };
  if (i.items.length > MAX_RUN_ITEMS) return { ok: false, error: `A run can have up to ${MAX_RUN_ITEMS} invoices. Split it in two.` };
  const seen = new Set<string>();
  const items: RunItem[] = [];
  for (const it of i.items) {
    const invoiceId = typeof it?.invoiceId === "string" ? it.invoiceId : "";
    const amount = Number(it?.amount);
    if (!invoiceId) return { ok: false, error: "One of the invoices is missing." };
    if (seen.has(invoiceId)) return { ok: false, error: "The same invoice is in the run twice." };
    if (!Number.isFinite(amount) || amount <= 0 || toMinor(amount) <= 0) return { ok: false, error: "Every amount must be more than zero." };
    seen.add(invoiceId);
    items.push({ invoiceId, amount: toMinor(amount) / 100 });
  }
  const paidOn = typeof i.paidOn === "string" ? i.paidOn : "";
  if (!YMD.test(paidOn) || new Date(`${paidOn}T00:00:00Z`).toISOString().slice(0, 10) !== paidOn) return { ok: false, error: "Choose the date the money was paid." };
  if (paidOn > today) return { ok: false, error: "The payment date cannot be in the future." };
  const mode = (typeof i.mode === "string" ? i.mode : "").trim();
  const reference = (typeof i.reference === "string" ? i.reference : "").trim();
  if (mode.length > 50) return { ok: false, error: "Keep the payment mode under 50 characters." };
  if (reference.length > 100) return { ok: false, error: "Keep the reference under 100 characters." };
  return { ok: true, run: { items, paidOn, mode, reference } };
}

export const PAYMENT_MODES = ["Bank transfer", "UPI", "NEFT", "RTGS", "Cheque", "Cash", "Card", "Other"];

/** Sum of the chosen amounts, in paise. */
export function runTotalMinor(items: { amount: number }[]): number {
  return items.reduce((s, x) => s + toMinor(x.amount), 0);
}
