/**
 * Which company a user lands in after sign-in (step 2b of
 * docs/PHASE-2-COMPANIES.md). A person can belong to several companies; until
 * a company switcher exists we pick the oldest membership whose company is
 * allowed to sign in. Suspended or closed companies cannot be entered.
 */

export type OrgRole = "ADMIN" | "STAFF";

export type MembershipWithOrg = {
  organizationId: string;
  role: OrgRole;
  createdAt: Date;
  organization: { status: string };
};

const SIGN_IN_ALLOWED = new Set(["TRIAL", "ACTIVE", "PAST_DUE"]);

export function isOrgAllowedToSignIn(status: string) {
  return SIGN_IN_ALLOWED.has(status);
}

export function pickDefaultMembership<T extends MembershipWithOrg>(
  memberships: T[]
): T | null {
  const usable = memberships
    .filter((m) => isOrgAllowedToSignIn(m.organization.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return usable[0] ?? null;
}
