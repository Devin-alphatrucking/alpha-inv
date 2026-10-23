// Rate alerts: is this line's rate much higher (or lower) than what the company usually pays for the same item?
// Pure functions, unit-tested (rate-alerts.test.ts). The page loads the history; the review form calls rateAlert()
// on every keystroke, so a typed rate is judged at once.

/** Needs this many earlier purchases before it dares to call a rate unusual. */
export const MIN_SAMPLES = 3;
/** Only the latest purchases count, so an old price from years ago does not set today's "usual". */
export const MAX_SAMPLES = 20;
export const HIGH_PERCENT = 15;
export const VERY_HIGH_PERCENT = 30;
export const LOW_PERCENT = -30;

export type RateSample = { rate: number; invoiceDate: Date; vendorName: string };

export type RateBaseline = {
  /** The middle rate of the earlier purchases (the median, so one odd price does not drag it). */
  usual: number;
  count: number;
  lastRate: number;
  lastDate: string; // YYYY-MM-DD
  lastVendor: string;
};

export type RateLevel = "high" | "very-high" | "low";
export type RateAlert = { level: RateLevel; percent: number; usual: number };

/** "Cement  OPC-53 (50kg)" and "CEMENT OPC 53 50KG" are the same item. */
export function normaliseDescription(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export const lineKey = (description: string, unit: string) => `${normaliseDescription(description)}|${normaliseDescription(unit)}`;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The baseline from earlier purchases of one item, or null when there are too few to judge by. Zero and negative rates (discount lines) are ignored. */
export function buildBaseline(samples: RateSample[]): RateBaseline | null {
  const usable = samples.filter((s) => Number.isFinite(s.rate) && s.rate > 0).sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime()).slice(0, MAX_SAMPLES);
  if (usable.length < MIN_SAMPLES) return null;
  const last = usable[0];
  return {
    usual: round2(median(usable.map((s) => s.rate))),
    count: usable.length,
    lastRate: last.rate,
    lastDate: last.invoiceDate.toISOString().slice(0, 10),
    lastVendor: last.vendorName,
  };
}

/** How far a rate is from the usual, in percent (rounded to 2 places), or null when it cannot be judged. */
export function deviationPercent(rate: number, baseline: Pick<RateBaseline, "usual"> | null | undefined): number | null {
  if (!baseline || !Number.isFinite(rate) || rate <= 0 || baseline.usual <= 0) return null;
  return round2(((rate - baseline.usual) / baseline.usual) * 100);
}

/** The warning for a rate, or null when it is in the normal range (or there is no history to compare with). */
export function rateAlert(rate: number, baseline: RateBaseline | null | undefined): RateAlert | null {
  const percent = deviationPercent(rate, baseline);
  if (percent === null || !baseline) return null;
  if (percent >= VERY_HIGH_PERCENT) return { level: "very-high", percent, usual: baseline.usual };
  if (percent >= HIGH_PERCENT) return { level: "high", percent, usual: baseline.usual };
  if (percent <= LOW_PERCENT) return { level: "low", percent, usual: baseline.usual };
  return null;
}

/** What a stored line carries: the deviation from the usual at the time it was saved, kept inside the column's range. */
export function storedDeviation(rate: number, baseline: RateBaseline | null | undefined): number | null {
  const p = deviationPercent(rate, baseline);
  return p === null ? null : Math.max(-9999, Math.min(9999, p));
}

/** Groups history rows by item (description + unit) into baselines. */
export function baselinesFrom(rows: { description: string; unit: string; rate: number; invoiceDate: Date; vendorName: string }[]): Map<string, RateBaseline> {
  const groups = new Map<string, RateSample[]>();
  for (const r of rows) {
    const key = lineKey(r.description, r.unit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ rate: r.rate, invoiceDate: r.invoiceDate, vendorName: r.vendorName });
  }
  const out = new Map<string, RateBaseline>();
  for (const [key, samples] of groups) {
    const baseline = buildBaseline(samples);
    if (baseline) out.set(key, baseline);
  }
  return out;
}
