import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/security/password";
import { issueToken } from "@/lib/security/tokens";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { accountExistsMail, verifyEmailMail } from "@/lib/email/templates";
import { absoluteUrl } from "@/lib/app-url";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { COUNTRY_DEFAULTS, STARTER_CATEGORIES, uniqueSlug } from "@/lib/org/starter-data";
import { trialDays } from "@/lib/plans/entitlements";
import { firstIssue, signUpSchema, type FlowResult } from "@/lib/flows/schemas";

const mailBrand = { name: PRODUCT_NAME };

/**
 * Self-service sign-up: creates a company (on a trial), its first admin, starter categories and a first
 * project, then emails a confirmation link. The person cannot sign in until the address is confirmed.
 *
 * The answer is the same whether or not the email already has an account (nobody can use this form to
 * discover who is registered); an existing account instead receives an "you already have an account" email.
 */
export async function signUp(raw: unknown, ctx: { ip: string }): Promise<FlowResult<{ checkEmail: true }>> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Sign-up is not available right now because email is not set up on this server." };
  }
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const v = parsed.data;

  const limit = await hitAll([
    { key: limitKey("signup:ip", ctx.ip), limit: 5, windowSeconds: 3600 },
    { key: limitKey("signup:email", v.email), limit: 3, windowSeconds: 3600 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  const existing = await rawDb.user.findUnique({ where: { email: v.email } });
  if (existing) {
    if (!existing.deletedAt) {
      await sendMail(accountExistsMail(v.email, { link: absoluteUrl("/forgot-password"), brand: mailBrand }));
    }
    return { ok: true, checkEmail: true };
  }

  const passwordHash = await hashPassword(v.password);
  const defaults = COUNTRY_DEFAULTS[v.country];
  const slug = await uniqueSlug(v.companyName, async (s) => Boolean(await rawDb.organization.findUnique({ where: { slug: s }, select: { id: true } })));

  let created: Awaited<ReturnType<typeof createCompanyAndAdmin>>;
  try {
    created = await createCompanyAndAdmin();
  } catch (error) {
    // Two sign-ups for the same address at the same moment: the loser gets the same neutral answer.
    if ((error as { code?: string }).code === "P2002") return { ok: true, checkEmail: true };
    throw error;
  }

  async function createCompanyAndAdmin() {
  return rawDb.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: v.companyName, slug, status: "TRIAL", country: v.country, currency: defaults.currency, timezone: defaults.timezone },
    });
    const user = await tx.user.create({
      data: {
        name: v.name,
        email: v.email,
        passwordHash,
        role: "ADMIN",
        termsAcceptedAt: new Date(),
        memberships: { create: { organizationId: org.id, role: "ADMIN" } },
      },
    });
    // A free trial of ONE project plan (same limits as the plan: 1 project, its users and AI pages).
    const plan = await tx.plan.findUnique({ where: { code: "PROJECT" } });
    if (!plan || !plan.active) throw new Error("The default plan (PROJECT) is missing. Run the database migrations.");
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        quantity: 1,
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + trialDays() * 86_400_000),
        provider: "manual",
      },
    });
    // The company tables are protected by Row-Level Security: say which company we are writing for.
    await tx.$executeRaw`SELECT set_config('app.org_id', ${org.id}, true)`;
    await tx.category.createMany({ data: STARTER_CATEGORIES.map((c) => ({ organizationId: org.id, name: c.name, unit: c.unit })) });
    const project = await tx.project.create({ data: { organizationId: org.id, name: "My first project" } });
    await tx.projectAssignment.create({ data: { organizationId: org.id, userId: user.id, projectId: project.id } });
    return { org, user };
  });
  }

  const token = await issueToken({ type: "EMAIL_VERIFY", email: v.email, userId: created.user.id });
  await sendMail(verifyEmailMail(v.email, { name: v.name, link: absoluteUrl(`/verify-email?token=${token}`), brand: mailBrand }));

  await logActivity({
    userId: created.user.id,
    organizationId: created.org.id,
    action: "USER_SIGNED_UP",
    module: "AUTH",
    entityId: created.org.id,
    details: { company: v.companyName, country: v.country },
  });
  return { ok: true, checkEmail: true };
}
