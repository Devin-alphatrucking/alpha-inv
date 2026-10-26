// Finding suppliers that are probably the same company entered twice. Pure functions, unit-tested (duplicates.test.ts).
// It only SUGGESTS: a person always decides, and two different GSTINs are never suggested (they are different registrations).

export type VendorLite = { id: string; name: string; gstin: string | null; invoices: number };

/** Words that say what kind of company it is, not which one: "Shree Cement Pvt. Ltd." and "SHREE CEMENT" are the same name. */
const FILLER = new Set(["PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "INC", "CO", "COMPANY", "CORP", "CORPORATION", "THE", "AND", "MS"]);

/** "M/s. Shree  Cement & Co. (P) Ltd" -> "SHREE CEMENT". Letters and digits only, filler words dropped. */
export function normaliseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bM\s*\/\s*S\b/g, " ") // "M/s" means "messrs", not part of the name
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !FILLER.has(t) && t !== "P")
    .join(" ");
}

/** Edit distance, with an early stop above `limit` (we only care about "within 1 or 2 letters"). */
export function distance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

export type Reason = "same-name" | "typo" | "contains";
export const REASON_TEXT: Record<Reason, string> = {
  "same-name": "Same name, apart from words like Pvt Ltd",
  typo: "Names differ by a letter or two",
  contains: "One name is part of the other",
};

/** Why two suppliers look like one company, or null. Different GSTINs (both filled in) are never suggested. */
export function whySame(a: VendorLite, b: VendorLite): Reason | null {
  if (a.gstin && b.gstin && a.gstin.trim().toUpperCase() !== b.gstin.trim().toUpperCase()) return null;
  const x = normaliseName(a.name);
  const y = normaliseName(b.name);
  if (!x || !y) return null;
  if (x === y) return "same-name";
  const limit = Math.min(x.length, y.length) >= 12 ? 2 : Math.min(x.length, y.length) >= 6 ? 1 : 0;
  if (limit > 0 && distance(x, y, limit) <= limit) return "typo";
  const [short, long] = x.length <= y.length ? [x.split(" "), y.split(" ")] : [y.split(" "), x.split(" ")];
  if (short.length >= 2 && short.length < long.length && short.every((t, i) => long[i] === t)) return "contains";
  return null;
}

export type DuplicateGroup = { vendors: VendorLite[]; reasons: Reason[]; keepId: string };

/**
 * Groups suppliers that look like the same company (a group can have more than two). `keepId` is the one to keep by default:
 * the one with a GSTIN, then the one with the most invoices, then the oldest by name order.
 */
export function findDuplicateGroups(vendors: VendorLite[]): DuplicateGroup[] {
  const parent = new Map(vendors.map((v) => [v.id, v.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const reasons = new Map<string, Set<Reason>>();
  for (let i = 0; i < vendors.length; i++) {
    for (let j = i + 1; j < vendors.length; j++) {
      const why = whySame(vendors[i], vendors[j]);
      if (!why) continue;
      const ra = find(vendors[i].id);
      const rb = find(vendors[j].id);
      if (ra !== rb) parent.set(ra, rb);
      const root = find(vendors[i].id);
      for (const key of [ra, rb, root]) {
        if (!reasons.has(root)) reasons.set(root, new Set());
        reasons.get(root)!.add(why);
        if (key !== root && reasons.has(key)) for (const r of reasons.get(key)!) reasons.get(root)!.add(r);
      }
    }
  }
  const groups = new Map<string, VendorLite[]>();
  for (const v of vendors) {
    const root = find(v.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(v);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const sorted = [...members].sort((a, b) => Number(Boolean(b.gstin)) - Number(Boolean(a.gstin)) || b.invoices - a.invoices || a.name.localeCompare(b.name));
      return { vendors: [...members].sort((a, b) => a.name.localeCompare(b.name)), reasons: [...(reasons.get(root) ?? [])], keepId: sorted[0].id };
    })
    .sort((a, b) => b.vendors.length - a.vendors.length || a.vendors[0].name.localeCompare(b.vendors[0].name));
}

/**
 * What would block merging `from` into `into`, as a plain sentence, or null when it is fine. Two different GSTINs mean two
 * registrations; the same invoice number on both would break the rule that a supplier's invoice numbers are unique.
 */
export function mergeProblem(from: { gstin: string | null }, into: { gstin: string | null }, fromNumbers: string[], intoNumbers: string[]): string | null {
  if (from.gstin && into.gstin && from.gstin.trim().toUpperCase() !== into.gstin.trim().toUpperCase()) {
    return "They have different GSTINs, so they are different registrations and should stay separate suppliers.";
  }
  const taken = new Set(intoNumbers.map((n) => n.trim().toUpperCase()));
  const clash = fromNumbers.filter((n) => taken.has(n.trim().toUpperCase()));
  if (clash.length > 0) {
    const shown = [...new Set(clash)].slice(0, 5).join(", ");
    return `Both suppliers have an invoice numbered ${shown}${clash.length > 5 ? " and more" : ""}. Open the repeated invoice and delete or renumber it first.`;
  }
  return null;
}
