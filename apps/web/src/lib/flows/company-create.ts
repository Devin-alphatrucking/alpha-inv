import { z } from "zod";
import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hit, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { COUNTRY_CODES, uniqueSlug } from "@/lib/org/starter-data";
import { provisionCompanyForUser } from "@/lib/org/provision";
import { trialDays } from "@/lib/plans/entitlements";
import { firstIssue, type FlowResult } from "@/lib/flows/schemas";

/**
 * A person who already has an account (for example an employee of another company) starts a company of their own. They keep
 * one sign-in; the new company is separate (its own trial, plan, people and data) and they are its administrator. Nothing in
 * their employer's company changes, and the employer cannot see the new one.
 *
 * Limits: the address must be confirmed, at most MAX_OWNED companies where the person is administrator, and 3 new companies a
 * day (each starts a free trial, so this stops trial farming).
 */
export const MAX_OWNED_COMPANIES = 5;

const schema = z.object({
  companyName: z.string().trim().min(2, "Enter your company name (at least 2 characters).").max(80, "Keep the company name under 80 characters."),
  country: z.enum(COUNTRY_CODES, { message: "Choose a country." }),
});

export async function createOwnCompany(user: { id: string }, raw: unknown): Promise<FlowResult<{ orgId: string; name: string }>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const v = parsed.data;

  const person = await rawDb.user.findUnique({ where: { id: user.id }, select: { id: true, deletedAt: true, emailVerifiedAt: true } });
  if (!person || person.deletedAt) return { ok: false, error: "Account not found." };
  if (!person.emailVerifiedAt) return { ok: false, error: "Confirm your email address first." };

  const limit = await hit(limitKey("company:create", user.id), 3, 86_400);
  if (!limit.allowed) return { ok: false, error: `You can start 3 companies a day. ${retryMessage(limit.retryAfterSeconds)}` };

  const owned = await rawDb.membership.count({ where: { userId: user.id, role: "ADMIN", organization: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED"] } } } });
  if (owned >= MAX_OWNED_COMPANIES) return { ok: false, error: `You already run ${owned} companies, which is the most one person can start here. Contact support if you need more.` };

  const slug = await uniqueSlug(v.companyName, async (s) => Boolean(await rawDb.organization.findUnique({ where: { slug: s }, select: { id: true } })));
  const { org } = await rawDb.$transaction((tx) => provisionCompanyForUser(tx, { companyName: v.companyName, slug, country: v.country, userId: user.id, mode: { kind: "trial", days: trialDays() } }));

  await logActivity({ userId: user.id, organizationId: org.id, action: "COMPANY_CREATED", module: "COMPANY", entityId: org.id, details: { company: v.companyName, country: v.country, by: "existing account" } });
  return { ok: true, orgId: org.id, name: org.name };
}
