import { randomBytes } from "node:crypto";
import { z } from "zod";
import { rawDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logActivity, type ActivityAction } from "@/lib/activity";
import { hashPassword } from "@/lib/security/password";
import { issueToken } from "@/lib/security/tokens";
import { isEmailConfigured, sendMail, sendMailQuietly } from "@/lib/email/transport";
import { twoStepResetMail, welcomeMail } from "@/lib/email/templates";
import { absoluteUrl } from "@/lib/app-url";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { COUNTRY_CODES, uniqueSlug } from "@/lib/org/starter-data";
import { provisionCompany } from "@/lib/org/provision";
import { parseReason } from "./ops";
import type { PlatformAdmin } from "./guard";

/**
 * The master console's account tools: set a company up by hand, and turn off a person's two-step sign-in after an identity
 * check. Like every master operation they need a written reason and are written to the activity log (module MASTER).
 */

const WELCOME_DAYS = 7;
const mailBrand = { name: PRODUCT_NAME };

function refuse(message: string): never {
  throw new AppError("VALIDATION_001", message);
}

function audit(admin: PlatformAdmin, orgId: string | null, action: ActivityAction, details: Record<string, unknown>) {
  return logActivity({ userId: admin.id, organizationId: orgId, action, module: "MASTER", entityId: orgId, details: { by: admin.email, ...details } });
}

const newCompanySchema = z.object({
  companyName: z.string().trim().min(2, "Enter the company name (at least 2 characters).").max(80, "Keep the company name under 80 characters."),
  country: z.enum(COUNTRY_CODES, { message: "Choose a country." }),
  adminName: z.string().trim().min(1, "Enter the administrator's name.").max(80, "Keep the name under 80 characters."),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address for the administrator.").max(160),
  mode: z.enum(["trial", "managed"], { message: "Choose a free trial or a plan managed by hand." }),
  days: z.number().int().min(1, "Trial days must be 1 to 365.").max(365, "Trial days must be 1 to 365."),
  quantity: z.number().int().min(1, "Project plans must be 1 to 1000.").max(1000, "Project plans must be 1 to 1000."),
});

/**
 * Sets a company up by hand for a customer (a partner, a sales deal, someone who cannot use the sign-up form): the company,
 * its first administrator, starter categories and a first project, on either a free trial or a plan managed by hand.
 * The administrator gets an email with a link to choose their own password, which also confirms their address; nobody
 * (including us) ever knows or sets it. An address that already has an account is refused, so this can never attach
 * someone to a company without them.
 */
export async function createCompanyByHand(admin: PlatformAdmin, input: unknown, reason: unknown) {
  const v = newCompanySchema.safeParse(input);
  if (!v.success) return refuse(v.error.issues[0].message);
  const why = parseReason(reason);
  const d = v.data;
  if (!isEmailConfigured()) return refuse("Email is not set up on this server, so the administrator could not be sent their link. Set up email first.");

  const existing = await rawDb.user.findUnique({ where: { email: d.adminEmail }, select: { id: true } });
  if (existing) return refuse("That email address already has an account. Ask them to sign in (or reset their password), or invite them to the company from inside the app.");

  const slug = await uniqueSlug(d.companyName, async (s) => Boolean(await rawDb.organization.findUnique({ where: { slug: s }, select: { id: true } })));
  // Nobody knows this password: the person chooses theirs from the emailed link.
  const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
  const mode = d.mode === "managed" ? ({ kind: "managed", quantity: d.quantity } as const) : ({ kind: "trial", days: d.days } as const);

  let created: Awaited<ReturnType<typeof provisionCompany>>;
  try {
    created = await rawDb.$transaction((tx) =>
      provisionCompany(tx, { companyName: d.companyName, slug, country: d.country, adminName: d.adminName, adminEmail: d.adminEmail, passwordHash, termsAccepted: false, mode }),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return refuse("That email address was just registered by someone else. Nothing was created.");
    throw error;
  }

  const token = await issueToken({ type: "PASSWORD_RESET", email: d.adminEmail, userId: created.user.id, ttlMs: WELCOME_DAYS * 86_400_000 });
  const sent = await sendMail(welcomeMail(d.adminEmail, { name: d.adminName, company: d.companyName, link: absoluteUrl(`/reset-password?token=${token}`), days: WELCOME_DAYS, brand: mailBrand }));
  await audit(admin, created.org.id, "MASTER_CREATED_COMPANY", {
    reason: why,
    company: d.companyName,
    adminEmail: d.adminEmail,
    plan: d.mode === "managed" ? `${d.quantity} project plan(s) by hand` : `${d.days}-day trial`,
    emailed: sent.ok,
  });
  return { orgId: created.org.id, emailed: sent.ok };
}

/**
 * Turns off a person's two-step sign-in after our team has checked who they are (by a call back, a signed request, whatever the
 * team's rule is: the console cannot check, so the operator must confirm they did). Signs the person out everywhere, removes their
 * recovery codes, tells them by email, and writes who did it and why. Refused for operators (their protection is not ours to remove),
 * for yourself, and for someone who is not in this company.
 */
export async function resetTwoStep(admin: PlatformAdmin, orgId: string, userId: string, reason: unknown, identityChecked: unknown) {
  if (identityChecked !== true) return refuse("Tick the box to confirm you checked who this person is before turning off their protection.");
  const why = parseReason(reason);
  const org = await rawDb.organization.findUnique({ where: { id: String(orgId) }, select: { id: true } });
  if (!org) throw new AppError("NOT_FOUND_001", "Company not found.");
  const member = await rawDb.membership.findFirst({
    where: { organizationId: org.id, userId: String(userId) },
    select: { user: { select: { id: true, name: true, email: true, deletedAt: true, isPlatformAdmin: true, totpEnabledAt: true } } },
  });
  const user = member?.user;
  if (!user || user.deletedAt) throw new AppError("NOT_FOUND_001", "That person is not in this company.");
  if (user.id === admin.id) return refuse("You cannot reset your own two-step sign-in here. Use your Account page.");
  if (user.isPlatformAdmin) return refuse("This is a platform operator account. Their two-step sign-in cannot be reset from the console.");
  if (!user.totpEnabledAt) return refuse("Two-step sign-in is not turned on for this person.");

  await rawDb.$transaction([
    rawDb.user.update({
      where: { id: user.id },
      // sessionVersion makes every session, on the web and on a phone, stop working
      data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } },
    }),
    rawDb.recoveryCode.deleteMany({ where: { userId: user.id } }),
    rawDb.mobileSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "two_step_reset" } }),
  ]);
  await sendMailQuietly(twoStepResetMail(user.email, { name: user.name, brand: mailBrand }));
  await audit(admin, org.id, "MASTER_RESET_TWO_STEP", { reason: why, person: user.email, identityChecked: true });
  return { email: user.email };
}
