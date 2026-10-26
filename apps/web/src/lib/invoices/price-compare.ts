// Price comparison: the same item bought from different suppliers, and what buying it all at the cheapest one would have saved.
// Pure functions, unit-tested (price-compare.test.ts). Rates are before GST. Money is plain numbers rounded to paise at the end.
import { lineKey } from "./rate-alerts";

export type PurchaseLine = { description: string; unit: string; rate: number; quantity: number; vendorId: string; vendorName: string; invoiceDate: Date };

export type SupplierPrice = {
  vendorId: string;
  vendorName: string;
  quantity: number;
  spend: number;
  /** Average rate you paid, weighted by quantity (a big order counts for more than a small one). */
  avgRate: number;
  lastRate: number;
  lastDate: string; // YYYY-MM-DD
  purchases: number;
  /** How far above the cheapest supplier's average this supplier is, in percent (0 for the cheapest). */
  premiumPercent: number;
  /** What the quantity bought here would have cost less at the cheapest supplier's average. */
  extraPaid: number;
};

export type ItemComparison = {
  key: string;
  description: string;
  unit: string;
  suppliers: SupplierPrice[]; // cheapest first
  cheapestId: string;
  /** Total of every other supplier's `extraPaid`. */
  potentialSaving: number;
  /** The biggest premium among the other suppliers. */
  maxPremiumPercent: number;
};

/** A difference smaller than this (in percent) is not worth acting on. */
export const MIN_PREMIUM_PERCENT = 5;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Groups purchases by item (description + unit, letters and punctuation ignored), then by supplier. Only items bought from at
 * least two suppliers are compared. Lines with no quantity or no positive rate (discount lines) are ignored. The cheapest supplier
 * is the lowest quantity-weighted average rate; on a tie the one you buy more from. Items where the dearest supplier is less than
 * `minPremium` percent above the cheapest are left out unless `includeSmall` is set. Biggest potential saving first.
 */
export function comparePrices(lines: PurchaseLine[], opts: { minPremium?: number; includeSmall?: boolean } = {}): ItemComparison[] {
  const minPremium = opts.minPremium ?? MIN_PREMIUM_PERCENT;
  type Acc = { description: string; unit: string; byVendor: Map<string, { name: string; qty: number; spend: number; purchases: number; last: PurchaseLine }> };
  const items = new Map<string, Acc>();

  for (const l of lines) {
    if (!Number.isFinite(l.rate) || !Number.isFinite(l.quantity) || l.rate <= 0 || l.quantity <= 0) continue;
    const key = lineKey(l.description, l.unit);
    if (key === "|") continue;
    let item = items.get(key);
    if (!item) items.set(key, (item = { description: l.description.trim(), unit: l.unit.trim(), byVendor: new Map() }));
    let v = item.byVendor.get(l.vendorId);
    if (!v) item.byVendor.set(l.vendorId, (v = { name: l.vendorName, qty: 0, spend: 0, purchases: 0, last: l }));
    v.qty += l.quantity;
    v.spend += l.rate * l.quantity;
    v.purchases += 1;
    if (l.invoiceDate.getTime() >= v.last.invoiceDate.getTime()) v.last = l; // on the same day, the later line wins
  }

  const out: ItemComparison[] = [];
  for (const [key, item] of items) {
    if (item.byVendor.size < 2) continue;
    const base = [...item.byVendor.entries()].map(([vendorId, v]) => ({ vendorId, ...v, avg: v.spend / v.qty }));
    base.sort((a, b) => a.avg - b.avg || b.qty - a.qty);
    const cheapest = base[0];
    const suppliers: SupplierPrice[] = base.map((v) => ({
      vendorId: v.vendorId,
      vendorName: v.name,
      quantity: r2(v.qty),
      spend: r2(v.spend),
      avgRate: r2(v.avg),
      lastRate: v.last.rate,
      lastDate: v.last.invoiceDate.toISOString().slice(0, 10),
      purchases: v.purchases,
      premiumPercent: v === cheapest ? 0 : r2(((v.avg - cheapest.avg) / cheapest.avg) * 100),
      extraPaid: v === cheapest ? 0 : r2(Math.max(0, (v.avg - cheapest.avg) * v.qty)),
    }));
    const maxPremiumPercent = Math.max(...suppliers.map((s) => s.premiumPercent));
    if (!opts.includeSmall && maxPremiumPercent < minPremium) continue;
    out.push({ key, description: item.description, unit: item.unit, suppliers, cheapestId: cheapest.vendorId, potentialSaving: r2(suppliers.reduce((s, x) => s + x.extraPaid, 0)), maxPremiumPercent });
  }
  return out.sort((a, b) => b.potentialSaving - a.potentialSaving || b.maxPremiumPercent - a.maxPremiumPercent || a.description.localeCompare(b.description));
}

/** Months back from `today` (YYYY-MM-DD) as the first date included (same day of the month, clamped for short months). */
export function sinceDate(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const PERIOD_CHOICES = [3, 6, 12, 24] as const;

/** ?months=6 as a number, only from the choices we offer; anything else is 12. */
export function parseMonths(raw: unknown): number {
  const n = Number(raw);
  return (PERIOD_CHOICES as readonly number[]).includes(n) ? n : 12;
}
