// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { canOpenPath, COMMON_PATHS, hasPermission, homeFor, isRole, needsProjects, permissionsOf, ROLE_INFO, ROLES, ROUTE_PERMISSIONS, seesAllProjects, type Permission, type RoleName } from "./roles";

// ---- the list of roles
assert.deepEqual([...ROLES], ["ADMIN", "ACCOUNTANT", "PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"]);
for (const r of ROLES) assert.ok(ROLE_INFO[r].label && ROLE_INFO[r].summary, `${r} is described`);
assert.ok(isRole("ACCOUNTANT") && isRole("STAFF"));
assert.ok(!isRole("OWNER") && !isRole(undefined) && !isRole(7) && !isRole(""));

// ---- the administrator holds everything; nobody else holds the owner's permissions
const all = permissionsOf("ADMIN");
for (const r of ROLES.filter((x) => x !== "ADMIN")) {
  for (const owner of ["user:manage", "project:manage", "logs:view"] as Permission[]) assert.ok(!hasPermission(r, owner), `${r} must not hold ${owner}`);
  assert.ok(permissionsOf(r).length < all.length);
}
assert.ok(!hasPermission(undefined, "dashboard:view") && !hasPermission(null, "invoice:view"));

// ---- who can do what, spelled out
const can = (r: RoleName, ...ps: Permission[]) => ps.every((p) => hasPermission(r, p));
const cannot = (r: RoleName, ...ps: Permission[]) => ps.every((p) => !hasPermission(r, p));
assert.ok(can("ACCOUNTANT", "payment:create", "payment:delete", "payment:plan", "report:view", "vendor:manage", "category:manage", "invoice:delete", "budget:view", "price:compare"));
assert.ok(cannot("ACCOUNTANT", "user:manage", "project:manage", "logs:view"));
assert.ok(can("PURCHASE", "vendor:manage", "price:compare", "material:view", "invoice:upload", "invoice:review"));
assert.ok(cannot("PURCHASE", "payment:create", "payment:view", "report:view", "budget:view", "invoice:delete"));
assert.ok(can("MANAGER", "budget:view", "invoice:review", "material:view"));
assert.ok(cannot("MANAGER", "payment:create", "vendor:manage", "report:view"));
assert.ok(can("ENGINEER", "invoice:upload", "invoice:review", "comment:write", "project:view"));
assert.ok(cannot("ENGINEER", "payment:create", "vendor:view", "budget:view", "invoice:delete"));
assert.ok(can("VIEWER", "dashboard:view", "invoice:view", "project:view", "budget:view"));
assert.ok(cannot("VIEWER", "invoice:upload", "invoice:review", "invoice:delete", "comment:write", "payment:create"), "a viewer can only read");
// the original role is exactly what it was before roles existed (plus comments)
assert.deepEqual(permissionsOf("STAFF").sort(), ["comment:write", "dashboard:view", "invoice:delete", "invoice:review", "invoice:upload", "invoice:view", "payment:create", "project:view"]);

// ---- which roles see every project
assert.deepEqual(ROLES.filter(seesAllProjects), ["ADMIN", "ACCOUNTANT"]);
assert.deepEqual(ROLES.filter(needsProjects), ["PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"]);
assert.ok(!seesAllProjects(undefined) && !seesAllProjects(null));

// ---- paths
const open = (r: RoleName | null | undefined, p: string) => canOpenPath(r, p);
for (const p of ["/dashboard", "/payments", "/users", "/admin/settings", "/plan", "/vendors", "/api/admin/export", "/master"]) assert.ok(open("ADMIN", p), `admin ${p}`);
// the accountant works across projects but owns nothing of the company's setup
for (const p of ["/dashboard", "/invoices", "/payments", "/payments/planner", "/reports/gst", "/materials", "/materials/compare", "/vendors", "/categories", "/api/reports/gst"]) assert.ok(open("ACCOUNTANT", p), `accountant ${p}`);
for (const p of ["/users", "/plan", "/admin/settings", "/admin/activity", "/api/admin/export", "/api/billing/checkout"]) assert.ok(!open("ACCOUNTANT", p), `accountant must not open ${p}`);
// staff keep exactly the pages they had
for (const p of ["/dashboard", "/invoices", "/invoices/upload", "/projects", "/account", "/support", "/api/invoices/x/file"]) assert.ok(open("STAFF", p), `staff ${p}`);
for (const p of ["/payments", "/payments/planner", "/vendors", "/materials", "/categories", "/reports/gst", "/users", "/plan", "/admin/errors", "/something-new"]) assert.ok(!open("STAFF", p), `staff must not open ${p}`);
// the purchase officer gets suppliers and prices but no money screens
assert.ok(open("PURCHASE", "/vendors") && open("PURCHASE", "/vendors/abc") && open("PURCHASE", "/materials") && open("PURCHASE", "/materials/compare"));
assert.ok(!open("PURCHASE", "/payments") && !open("PURCHASE", "/reports/gst") && !open("PURCHASE", "/categories"));
// a path that only starts with the same letters is not the same path
assert.ok(!open("STAFF", "/paymentsX"), "unknown paths are closed to project-limited roles");
assert.ok(open("STAFF", "/invoices/123/review"));
assert.ok(!open(undefined, "/dashboard") && !open(null, "/"));
// the longest rule wins: the planner needs its own permission, not just payment:view
assert.ok(!hasPermission("VIEWER", "payment:plan"));
assert.ok(!open("VIEWER", "/payments/planner") && !open("VIEWER", "/payments"));
for (const rule of ROUTE_PERMISSIONS) assert.ok(rule.prefix.startsWith("/"));
for (const p of COMMON_PATHS) assert.ok(open("VIEWER", p), `viewer ${p}`);

// ---- where people land
assert.equal(homeFor("ADMIN"), "/dashboard");
assert.equal(homeFor("ACCOUNTANT"), "/dashboard");
assert.equal(homeFor("STAFF"), "/invoices/upload");
assert.equal(homeFor("ENGINEER"), "/invoices/upload");
assert.equal(homeFor("VIEWER"), "/dashboard", "a viewer cannot upload, so the dashboard is home");
assert.equal(homeFor(undefined), "/dashboard");

console.log("roles: all checks passed");
