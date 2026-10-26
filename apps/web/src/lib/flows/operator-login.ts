import { z } from "zod";
import type { RoleName } from "@/lib/roles";
import { rawDb } from "@/lib/db";
import { platformTx } from "@/lib/master/db";
import { logActivity } from "@/lib/activity";
import { verifyPassword } from "@/lib/security/password";
import { hit, hitAll, limitKey } from "@/lib/security/rate-limit";
import { checkSecondFactor } from "@/lib/flows/two-factor";
import { loadDefaultMembership } from "@/lib/org/membership-load";
import { sendMailQuietly } from "@/lib/email/transport";
import { operatorAlertMail } from "@/lib/email/templates";

/**
 * Sign-in for the master console, on its own address. It is separate from the customers' sign-in on purpose:
 *  - only platform operators with two-step sign-in turned on can use it, and the code is asked together with the password,
 *    so a failure never says which part was wrong or whether the address belongs to an operator;
 *  - it has its own, stricter limits, so customer traffic cannot lock an operator out (and the reverse);
 *  - it tells people when something looks unusual: a first sign-in from a new network address, or repeated failures.
 */

const schema = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200), code: z.string().min(1).max(40) });
const brand = { name: "Master console" };

export type OperatorLoginResult =
  | { ok: true; user: { id: string; name: string; email: string; role: RoleName; orgId: string; orgRole: RoleName; sv: number } }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Who is told about unusual sign-ins besides the operator: SECURITY_ALERT_EMAIL (one or more addresses, comma separated). */
const securityContacts = () => (process.env.SECURITY_ALERT_EMAIL ?? "").split(",").map((a) => a.trim()).filter((a) => a.includes("@"));
const when = () => `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`;

export async function operatorLogin(input: { email: unknown; password: unknown; code: unknown; ip: string; userAgent?: string | null }): Promise<OperatorLoginResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const email = parsed.data.email.trim().toLowerCase();
  const ip = input.ip || "unknown";

  // Every attempt counts, right or wrong. A small number per address and per network address: operators are few and know their details.
  const limit = await hitAll([
    { key: limitKey("operator:email", email), limit: 6, windowSeconds: 900 },
    { key: limitKey("operator:ip", ip), limit: 12, windowSeconds: 900 },
  ]);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  const user = await rawDb.user.findUnique({ where: { email } });
  // Always a real password comparison, so timing does not tell whether the address exists.
  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash);
  const eligible = Boolean(user && passwordOk && user.isPlatformAdmin && !user.deletedAt && user.emailVerifiedAt && user.totpEnabledAt);

  let secondOk = false;
  if (user && eligible) {
    const second = await checkSecondFactor(user.id, parsed.data.code.trim());
    if (!second.ok && second.reason === "rate_limited") return { ok: false, reason: "rate_limited" };
    secondOk = second.ok;
  }
  const membership = user && eligible && secondOk ? await loadDefaultMembership(user.id) : null;

  if (!user || !eligible || !secondOk || !membership) {
    await noteFailure(email, ip, user?.isPlatformAdmin === true ? { id: user.id, email: user.email } : null, input.userAgent);
    return { ok: false, reason: "invalid" };
  }

  // A network address this operator has not signed in from before.
  // (Logs can only be read by their own company or by the platform, so this reads as the platform.)
  const seen = await platformTx((tx) => tx.activityLog.count({ where: { userId: user.id, action: "MASTER_LOGIN", ipAddress: ip } }));
  await logActivity({ userId: user.id, organizationId: null, action: "MASTER_LOGIN", module: "MASTER", entityId: user.id, details: { email }, ipAddress: ip, userAgent: input.userAgent ?? null });
  if (seen === 0) {
    for (const to of new Set([user.email, ...securityContacts()])) await sendMailQuietly(operatorAlertMail(to, { kind: "new_place", ip, when: when(), email: user.email, brand }));
  }
  return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: membership.role, orgId: membership.organizationId, orgRole: membership.role, sv: user.sessionVersion } };
}

/** Counts failures per address over an hour and raises the alarm once, on the fifth. Only real operators and the security contacts are told. */
async function noteFailure(email: string, ip: string, operator: { id: string; email: string } | null, userAgent?: string | null) {
  const failures = await hit(limitKey("operator:fail", email), 100000, 3600);
  if (failures.count !== 5) return;
  await logActivity({ userId: operator?.id ?? null, action: "MASTER_LOGIN_FAILED", module: "MASTER", entityId: operator?.id ?? null, details: { attempts: failures.count, email }, ipAddress: ip, userAgent: userAgent ?? null });
  const to = new Set<string>(securityContacts());
  if (operator) to.add(operator.email);
  for (const address of to) await sendMailQuietly(operatorAlertMail(address, { kind: "many_failures", ip, when: when(), email, brand }));
}
