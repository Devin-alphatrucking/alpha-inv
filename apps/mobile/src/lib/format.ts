// Money and dates the way the company set them up on the website (currency, locale, time zone).

export type FormatSettings = { currency?: string; locale?: string; timezone?: string };

export function money(value: string | number, f: FormatSettings = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat(f.locale || "en-IN", { style: "currency", currency: f.currency || "INR", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${f.currency ?? ""}`.trim();
  }
}

export function day(value: string | null | undefined, f: FormatSettings = {}) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(f.locale || "en-IN", { dateStyle: "medium", timeZone: f.timezone || undefined }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

export const STATUS_LABEL: Record<string, string> = {
  PROCESSING: "Reading",
  NEEDS_REVIEW: "Needs review",
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
};
