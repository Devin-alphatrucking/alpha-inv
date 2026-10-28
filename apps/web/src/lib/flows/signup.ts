import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/security/password";
import { issueToken } from "@/lib/security/tokens";
import { issueOtp } from "@/lib/security/otp";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { isEmailConfigured, sendMailQuietly } from "@/lib/email/transport";
import { accountExistsMail, verifyEmailMail } from "@/lib/email/templates";
import { absoluteUrl } from "@/lib/app-url";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { uniqueSlug } from "@/lib/org/starter-data";
import { normalizePhone } from "@/lib/security/phone";
import { provisionCompany } from "@/lib/org/provision";
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
    // Do the same expensive work as a real sign-up, so the time taken does not tell an attacker the address is registered.
    await hashPassword(v.password);
    if (!existing.deletedAt) {
      await sendMailQuietly(accountExistsMail(v.email, { link: absoluteUrl("/forgot-password"), brand: mailBrand }));
    }
    return { ok: true, checkEmail: true };
  }

  const passwordHash = await hashPassword(v.password);
  const phone = normalizePhone(v.phone, v.country); // already checked by the schema
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
    return rawDb.$transaction((tx) =>
      provisionCompany(tx, { companyName: v.companyName, slug, country: v.country, adminName: v.name, adminEmail: v.email, adminPhone: phone.ok ? phone.phone : null, passwordHash, termsAccepted: true, mode: { kind: "trial", days: trialDays() } }),
    );
  }

  const token = await issueToken({ type: "EMAIL_VERIFY", email: v.email, userId: created.user.id });
  const otp = await issueOtp({ purpose: "SIGNUP", email: v.email, userId: created.user.id });
  await sendMailQuietly(verifyEmailMail(v.email, { name: v.name, link: absoluteUrl(`/verify-email?token=${token}`), brand: mailBrand, code: otp.ok ? otp.code : undefined }));

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
