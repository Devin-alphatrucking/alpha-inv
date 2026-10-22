// Run with: npx tsx apps/web/src/lib/org/default-membership.test.ts
import assert from "node:assert/strict";
import { pickDefaultMembership, type MembershipWithOrg } from "./default-membership";

const m = (org: string, status: string, day: number, role: "ADMIN" | "STAFF" = "STAFF"): MembershipWithOrg => ({
  organizationId: org,
  role,
  createdAt: new Date(2026, 0, day),
  organization: { status },
});

assert.equal(pickDefaultMembership([]), null, "no memberships -> null");
assert.equal(pickDefaultMembership([m("a", "SUSPENDED", 1)]), null, "suspended only -> null");
assert.equal(pickDefaultMembership([m("a", "CLOSED", 1)]), null, "closed only -> null");
assert.equal(pickDefaultMembership([m("b", "ACTIVE", 5), m("a", "ACTIVE", 2)])?.organizationId, "a", "oldest wins");
assert.equal(pickDefaultMembership([m("a", "SUSPENDED", 1), m("b", "TRIAL", 9)])?.organizationId, "b", "skips suspended");
assert.equal(pickDefaultMembership([m("a", "PAST_DUE", 1, "ADMIN")])?.role, "ADMIN", "past due may still sign in");
console.log("default-membership: all checks passed");
