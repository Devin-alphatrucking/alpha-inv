// GST summary rules. Pure functions, unit-tested (report.test.ts). Money is added in whole paise so totals never drift.
import { toMinor } from "@/lib/invoices/status";
import { checkGstin, hasValue } from "./gstin";

export type GstInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  vendorId: string;
  vendorName: string;
  vendorGstin: string | null;
  projectName: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  rounding: number;
  total: number;
  status: string;
};

export type GstTotals = { invoices: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; taxMinor: number; totalMinor: number };

export type GstMonth = GstTotals & { month: string }; // YYYY-MM
export type GstVendor = GstTotals & { vendorId: string; name: string; gstin: string | null };

export type GstReport = {
  totals: GstTotals;
  months: GstMonth[]; // oldest first
  vendors: GstVendor[]; // biggest tax first
  /** Invoices that carry tax but whose supplier has no GSTIN on file: the tax cannot be claimed until it is added. */
  missingGstin: { count: number; taxMinor: number };
  /** Invoices where the amounts do not add up (subtotal + tax + rounding is not the total). */
  mismatched: { id: string; invoiceNumber: string; vendorName: string; differenceMinor: number }[];
  /** Suppliers whose saved GSTIN is not a valid one (wrong length or pattern, or a last character that does not fit): probably misread. */
  invalidGstin: { vendorId: string; name: string; gstin: string; reason: string; invoices: number; taxMinor: number }[];
  /** Invoices carrying IGST together with CGST or SGST: a sale is either within the state or across states, never both. */
  mixedTax: { id: string; invoiceNumber: string; vendorName: string }[];
  /** Invoices with CGST and SGST that are not equal: the two are always the same amount. */
  splitMismatch: { id: string; invoiceNumber: string; vendorName: string; cgstMinor: number; sgstMinor: number }[];
};

const empty = (): GstTotals => ({ invoices: 0, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, taxMinor: 0, totalMinor: 0 });

function add(into: GstTotals, i: GstInvoice) {
  const cgst = toMinor(i.cgst);
  const sgst = toMinor(i.sgst);
  const igst = toMinor(i.igst);
  into.invoices += 1;
  into.taxableMinor += toMinor(i.subtotal);
  into.cgstMinor += cgst;
  into.sgstMinor += sgst;
  into.igstMinor += igst;
  into.taxMinor += cgst + sgst + igst;
  into.totalMinor += toMinor(i.total);
}

export const invoiceTaxMinor = (i: Pick<GstInvoice, "cgst" | "sgst" | "igst">) => toMinor(i.cgst) + toMinor(i.sgst) + toMinor(i.igst);

/** Calendar dates are stored at midnight UTC, so the month is read in UTC. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export function buildGstReport(invoices: GstInvoice[]): GstReport {
  const totals = empty();
  const byMonth = new Map<string, GstMonth>();
  const byVendor = new Map<string, GstVendor>();
  const missing = { count: 0, taxMinor: 0 };
  const mismatched: GstReport["mismatched"] = [];
  const invalid = new Map<string, GstReport["invalidGstin"][number]>();
  const mixedTax: GstReport["mixedTax"] = [];
  const splitMismatch: GstReport["splitMismatch"] = [];

  for (const i of invoices) {
    add(totals, i);
    const key = monthKey(i.invoiceDate);
    if (!byMonth.has(key)) byMonth.set(key, { ...empty(), month: key });
    add(byMonth.get(key)!, i);
    if (!byVendor.has(i.vendorId)) byVendor.set(i.vendorId, { ...empty(), vendorId: i.vendorId, name: i.vendorName, gstin: i.vendorGstin?.trim() || null });
    add(byVendor.get(i.vendorId)!, i);

    const tax = invoiceTaxMinor(i);
    if (tax > 0 && !i.vendorGstin?.trim()) {
      missing.count += 1;
      missing.taxMinor += tax;
    }
    // A rupee of slack covers rounding on the printed bill; anything more is worth a look.
    const difference = toMinor(i.total) - (toMinor(i.subtotal) + tax + toMinor(i.rounding));
    if (Math.abs(difference) > 100) mismatched.push({ id: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, differenceMinor: difference });

    if (hasValue(i.vendorGstin)) {
      const check = checkGstin(i.vendorGstin);
      if (!check.ok) {
        const row = invalid.get(i.vendorId) ?? { vendorId: i.vendorId, name: i.vendorName, gstin: i.vendorGstin!.trim(), reason: check.reason, invoices: 0, taxMinor: 0 };
        row.invoices += 1;
        row.taxMinor += tax;
        invalid.set(i.vendorId, row);
      }
    }
    const cgstMinor = toMinor(i.cgst);
    const sgstMinor = toMinor(i.sgst);
    if (toMinor(i.igst) > 0 && (cgstMinor > 0 || sgstMinor > 0)) mixedTax.push({ id: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName });
    // One paisa of slack: a printed bill can round each half differently.
    else if (Math.abs(cgstMinor - sgstMinor) > 1) splitMismatch.push({ id: i.id, invoiceNumber: i.invoiceNumber, vendorName: i.vendorName, cgstMinor, sgstMinor });
  }

  return {
    totals,
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    vendors: [...byVendor.values()].sort((a, b) => b.taxMinor - a.taxMinor || a.name.localeCompare(b.name)),
    missingGstin: missing,
    mismatched,
    invalidGstin: [...invalid.values()].sort((a, b) => b.taxMinor - a.taxMinor || a.name.localeCompare(b.name)),
    mixedTax,
    splitMismatch,
  };
}

// ---- periods

/** An Indian financial year runs 1 April to 31 March. `fy` is the year it starts in (2026 means Apr 2026 - Mar 2027). */
export function financialYearRange(fy: number): { from: string; to: string; label: string } {
  return { from: `${fy}-04-01`, to: `${fy + 1}-03-31`, label: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}` };
}

/** The financial year a calendar date (YYYY-MM-DD) falls in. */
export function financialYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Reads ?fy=2026 or ?from=YYYY-MM-DD&to=YYYY-MM-DD. Anything else (or a range that is backwards or longer than 5 years)
 * falls back to the financial year containing `today`.
 */
export function parsePeriod(params: { fy?: string | null; from?: string | null; to?: string | null }, today: string): { from: string; to: string; label: string; custom: boolean } {
  const fallback = () => ({ ...financialYearRange(financialYearOf(today)), custom: false });
  if (params.from || params.to) {
    if (!isDate(params.from) || !isDate(params.to) || params.from > params.to) return fallback();
    const span = new Date(`${params.to}T00:00:00Z`).getTime() - new Date(`${params.from}T00:00:00Z`).getTime();
    if (span > 5 * 366 * 86_400_000) return fallback();
    return { from: params.from, to: params.to, label: `${params.from} to ${params.to}`, custom: true };
  }
  if (params.fy) {
    const fy = Number(params.fy);
    if (/^\d{4}$/.test(params.fy) && fy >= 2000 && fy <= 2100) return { ...financialYearRange(fy), custom: false };
  }
  return fallback();
}

// ---- CSV

/** A cell that starts with = + - @ is run as a formula by spreadsheets; a leading quote makes it plain text. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(text); // a negative amount is a number, not a formula
  if (typeof value === "string" && !isPlainNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  // A byte-order mark makes Excel read the file as UTF-8 (vendor names with accents stay readable).
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Paise as a plain decimal string for a spreadsheet (no currency symbol, no commas). */
export const plain = (minor: number) => (minor / 100).toFixed(2);
