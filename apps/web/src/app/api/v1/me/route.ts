import { json, requireMobile, route } from "@/lib/mobile/http";
import { loadBrandById, publicBrand } from "@/lib/brand/brand";
import { listMyCompanies } from "@/lib/flows/account";
import { getEntitlements } from "@/lib/plans/entitlements";
import { blockedMessage } from "@/lib/plans/rules";
import { permissionsOf } from "@/lib/roles";

export const runtime = "nodejs";

/** Who is signed in, which company they are working in (with its branding), what the company's plan allows and how much is used. */
export const GET = route("/api/v1/me", async (req) => {
  const me = await requireMobile(req, { allowLocked: true });
  const [brand, companies, e] = await Promise.all([loadBrandById(me.orgId), listMyCompanies(me.id), getEntitlements(me.orgId)]);
  return json({
    user: { id: me.id, name: me.name, email: me.email, role: me.role },
    // What this role may do, so the app shows only the screens that will work for them (the server still checks every request).
    permissions: permissionsOf(me.role),
    company: { id: me.orgId, brand: brand ? publicBrand(brand) : null },
    companies,
    plan: {
      name: e.planName,
      state: e.state,
      message: blockedMessage(e.state) || null,
      quantity: e.quantity,
      trialEndsAt: e.trialEndsAt,
      trialDaysLeft: e.trialDaysLeft,
      currentPeriodEnd: e.currentPeriodEnd,
      graceEndsAt: e.graceEndsAt,
      limits: e.limits,
      usage: e.usage,
    },
  });
});
