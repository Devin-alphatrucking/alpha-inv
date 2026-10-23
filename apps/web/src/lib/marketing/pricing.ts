// What the public pricing page says about a plan. Pure functions, unit-tested (pricing.test.ts).

export type PublicPlan = {
  code: string;
  name: string;
  priceMinor: number | null;
  currency: string;
  interval: string; // MONTH | YEAR
  includedProjects: number;
  userLimit: number;
  aiPagesPerProject: number;
};

export type PlanView = {
  code: string;
  name: string;
  /** "₹1,999", or null while the price has not been set. */
  price: string | null;
  /** "per month" / "per year". */
  per: string;
  features: string[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** A price in minor units (paise, cents) as money. No decimals when it is a whole amount. Null for no price, a negative or a broken one. */
export function formatPrice(priceMinor: number | null | undefined, currency: string): string | null {
  if (priceMinor === null || priceMinor === undefined || !Number.isFinite(priceMinor) || priceMinor <= 0) return null;
  const major = priceMinor / 100;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(Number.isInteger(major) ? 0 : 2)}`;
  }
}

export const intervalLabel = (interval: string) => (interval === "YEAR" ? "per year" : "per month");

/** The plan as the page shows it. What one copy includes is stated as it is: a project, its team and its AI pages. */
export function planView(plan: PublicPlan): PlanView {
  return {
    code: plan.code,
    name: plan.name,
    price: formatPrice(plan.priceMinor, plan.currency),
    per: intervalLabel(plan.interval),
    features: [
      plural(plan.includedProjects, "project"),
      `Up to ${plural(plan.userLimit, "team member")}`,
      `${plural(plan.aiPagesPerProject, "AI-read page")} per project each month`,
      "Every feature included",
    ],
  };
}

/** The landing page replaces the sign-in redirect at "/" unless LANDING_PAGE=off (for deployments that are only a company's own app). */
export function landingEnabled(env: string | undefined): boolean {
  return (env ?? "").trim().toLowerCase() !== "off";
}
