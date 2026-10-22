// Defaults for a brand-new company created through sign-up. Pure, so it can be unit-tested.

export const COUNTRY_DEFAULTS: Record<string, { label: string; currency: string; timezone: string }> = {
  IN: { label: "India", currency: "INR", timezone: "Asia/Kolkata" },
  AU: { label: "Australia", currency: "AUD", timezone: "Australia/Sydney" },
  NZ: { label: "New Zealand", currency: "NZD", timezone: "Pacific/Auckland" },
  GB: { label: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  US: { label: "United States", currency: "USD", timezone: "America/New_York" },
  CA: { label: "Canada", currency: "CAD", timezone: "America/Toronto" },
  SG: { label: "Singapore", currency: "SGD", timezone: "Asia/Singapore" },
  AE: { label: "United Arab Emirates", currency: "AED", timezone: "Asia/Dubai" },
  ZA: { label: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg" },
};

export const COUNTRY_CODES = Object.keys(COUNTRY_DEFAULTS) as [string, ...string[]];

/** Categories every new company starts with (they can add, rename and remove their own). */
export const STARTER_CATEGORIES: { name: string; unit: string }[] = [
  { name: "Cement", unit: "BAG" },
  { name: "Steel", unit: "KG" },
  { name: "Plumbing", unit: "NOS" },
  { name: "Electrical", unit: "NOS" },
  { name: "Tiles", unit: "NOS" },
  { name: "Sanitaryware", unit: "NOS" },
  { name: "Paint", unit: "LTR" },
  { name: "Misc", unit: "NOS" },
];

/** Words that must never become a company code (they are routes or look official). */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "login", "logout", "signup", "register", "account", "www", "mail", "support",
  "help", "static", "assets", "public", "demo", "test", "default", "new", "null", "undefined", "billing", "status",
]);

/** "Acme Builders Pty Ltd" -> "acme-builders-pty-ltd" (2-30 chars, a-z 0-9 and dashes). */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "company";
}

/** Picks a free company code: the plain slug, then slug-2, slug-3 ... then a random suffix. */
export async function uniqueSlug(name: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(name);
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base.slice(0, 27)}-${i + 2}`)];
  for (const c of candidates) {
    if (!RESERVED_SLUGS.has(c) && !(await isTaken(c))) return c;
  }
  return `${base.slice(0, 22)}-${Math.random().toString(36).slice(2, 8)}`;
}
