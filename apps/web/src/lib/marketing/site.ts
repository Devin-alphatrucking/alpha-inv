import { rawDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { isEmailConfigured } from "@/lib/email/transport";
import { legalLinks } from "@/components/auth-shell";
import { supportAddress } from "@/lib/flows/support";
import { trialDays } from "@/lib/plans/entitlements";
import { planView, type PlanView } from "./pricing";

/** Everything the public pages share: the product's name, whether sign-up is open, the plans on sale, and who is looking. */
export async function loadSite() {
  const [session, plans] = await Promise.all([auth(), loadPlans()]);
  return {
    // The product itself, not whichever company's branding a cookie may remember.
    name: PRODUCT_NAME,
    signedIn: Boolean(session?.user),
    // The same rule as the sign-up page itself, so a button never leads to "not available".
    signupOpen: process.env.SIGNUP_ENABLED !== "false" && isEmailConfigured(),
    supportEmail: supportAddress(),
    legal: legalLinks(),
    trialDays: trialDays(),
    plans,
  };
}

/** The plans on sale. If the database cannot be reached the page still opens, with a plain "plans are being set up". */
async function loadPlans(): Promise<PlanView[]> {
  try {
    const rows = await rawDb.plan.findMany({ where: { active: true }, orderBy: [{ priceMinor: "asc" }, { createdAt: "asc" }] });
    return rows.map(planView);
  } catch (error) {
    console.error("[marketing] could not load plans:", error instanceof Error ? error.message : error);
    return [];
  }
}
