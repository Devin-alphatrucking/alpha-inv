import assert from "node:assert/strict";
import { ROLE_INFO, canOpenPath, type RoleName } from "./roles";
import { REPORT_LINKS, SETTINGS_LINKS, getNavItemsForRole, hubLinksFor } from "./nav";

const labels = (role: RoleName) => getNavItemsForRole(role).map((i) => i.label);
const roles = Object.keys(ROLE_INFO) as RoleName[];

// Accounts comes first, the other modules after it, Settings last; nothing about people or logs in the sidebar itself.
assert.deepEqual(labels("ADMIN"), ["Dashboard", "Upload invoice", "Invoices", "Payments", "Vendors", "Reports & tools", "Purchase", "Site work", "Settings"]);
assert.ok(getNavItemsForRole("ADMIN").length <= 10, "the sidebar stays short");
for (const gone of ["Users", "Projects", "Categories", "Activity Logs", "Error Logs", "Plan & usage", "Support", "Rate Sheet", "GST report"]) assert.ok(!labels("ADMIN").includes(gone), `${gone} moved out of the sidebar`);

// Roles limited to their own projects keep a small menu
assert.deepEqual(labels("STAFF"), ["Dashboard", "Upload invoice", "My invoices", "Settings"]);
assert.deepEqual(labels("ENGINEER").slice(0, 3), ["Dashboard", "Upload invoice", "My invoices"]);

// Every item of every role is somewhere that role may open, and the order of groups never mixes
const order = ["top", "accounts", "modules", "bottom"];
for (const role of roles) {
  const items = getNavItemsForRole(role);
  for (const i of items) assert.ok(canOpenPath(role, i.href), `${role} sees ${i.label} but may not open ${i.href}`);
  const idx = items.map((i) => order.indexOf(i.group));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${role}: groups are in order`);
  assert.equal(new Set(items.map((i) => i.label)).size, items.length, `${role}: no repeated entry`);
}

// Add-on modules: absent until the company switches them on, and then only for roles that hold their permission
const withSales = (role: RoleName) => getNavItemsForRole(role, ["sales"]).map((i) => i.label);
assert.ok(!labels("ADMIN").includes("Sales invoices"), "off by default");
assert.ok(withSales("ADMIN").includes("Sales invoices"), "on for the administrator");
assert.ok(withSales("ACCOUNTANT").includes("Sales invoices"), "on for the accountant");
for (const r of ["PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"] as RoleName[]) assert.ok(!withSales(r).includes("Sales invoices"), `${r} has no sales permission`);
assert.deepEqual(withSales("ADMIN").filter((l) => l !== "Sales invoices"), labels("ADMIN"), "switching it on changes nothing else");
for (const role of roles) for (const i of getNavItemsForRole(role, ["sales"])) assert.ok(canOpenPath(role, i.href), `${role} sees ${i.label} but may not open ${i.href}`);
assert.ok(hubLinksFor(SETTINGS_LINKS, "ADMIN").some((l) => l.href === "/admin/add-ons"), "the administrator can reach the switch page");
assert.ok(!hubLinksFor(SETTINGS_LINKS, "ACCOUNTANT").some((l) => l.href === "/admin/add-ons"), "nobody else can");

// Hubs: only what the role may open, and the administrator gets all of it
assert.equal(hubLinksFor(SETTINGS_LINKS, "ADMIN").length, SETTINGS_LINKS.length);
assert.equal(hubLinksFor(REPORT_LINKS, "ADMIN").length, REPORT_LINKS.length);
assert.ok(!hubLinksFor(SETTINGS_LINKS, "STAFF").some((l) => l.href === "/users" || l.href === "/plan" || l.href.startsWith("/admin")), "staff cannot open team, plan or logs");
assert.deepEqual(hubLinksFor(REPORT_LINKS, "STAFF"), [], "staff have no reports, so no Reports entry");
assert.ok(!labels("STAFF").includes("Reports & tools"));
assert.deepEqual(hubLinksFor(SETTINGS_LINKS, "ACCOUNTANT").map((l) => l.href).sort(), ["/account", "/categories", "/projects", "/support"]);

// The current place is highlighted in exactly one entry
const admin = getNavItemsForRole("ADMIN");
for (const [path, label] of [
  ["/dashboard", "Dashboard"],
  ["/invoices", "Invoices"],
  ["/invoices/abc", "Invoices"],
  ["/invoices/upload", "Upload invoice"],
  ["/invoices/abc/review", "Upload invoice"],
  ["/payments", "Payments"],
  ["/payments/planner", "Reports & tools"],
  ["/reports/gst", "Reports & tools"],
  ["/materials/compare", "Reports & tools"],
  ["/purchase/orders", "Purchase"],
  ["/site/issues", "Site work"],
  ["/users", "Settings"],
  ["/projects", "Settings"],
  ["/plan", "Settings"],
  ["/admin/activity", "Settings"],
  ["/settings", "Settings"],
] as const) {
  const on = admin.filter((i) => i.active(path)).map((i) => i.label);
  assert.deepEqual(on, [label], path);
}

console.log("navigation: all checks passed");
