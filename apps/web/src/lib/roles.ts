// Who can do what. One place for the roles, the permissions each role holds, which roles see every project, and which
// screens each permission opens. Pure and import-free so the sign-in guard (which runs at the edge), the server and the
// phone API all read the same table. Unit-tested (roles.test.ts).

/** The roles a person can hold in a company. STAFF is the original general role and keeps working exactly as before. */
export const ROLES = ["ADMIN", "ACCOUNTANT", "PURCHASE", "MANAGER", "ENGINEER", "VIEWER", "STAFF"] as const;
export type RoleName = (typeof ROLES)[number];

export const isRole = (value: unknown): value is RoleName => typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** What each role is for, as shown when inviting or editing a person. */
export const ROLE_INFO: Record<RoleName, { label: string; summary: string }> = {
  ADMIN: { label: "Administrator", summary: "Everything, including people, plans, settings and logs." },
  ACCOUNTANT: { label: "Accountant", summary: "All projects: invoices, payments, suppliers, GST report and planner. No people, plans or settings." },
  PURCHASE: { label: "Purchase officer", summary: "Assigned projects: upload and review invoices, manage suppliers, see rates and price comparison, and make purchase orders from approved material requests." },
  MANAGER: { label: "Project manager", summary: "Assigned projects: invoices, budgets and spend, and site work (reports, photos, issues) including submitting reports and closing issues. Approves material requests." },
  ENGINEER: { label: "Site engineer", summary: "Assigned projects: upload and review bills, and site work: daily reports, photos and issues. Raises material requests (does not see order prices)." },
  VIEWER: { label: "Viewer", summary: "Assigned projects: read only, including site reports and photos (for a client or an auditor)." },
  STAFF: { label: "General staff", summary: "Assigned projects: upload and review invoices, record payments." },
};

export type Permission =
  | "dashboard:view"
  | "invoice:view"
  | "invoice:upload"
  | "invoice:review"
  | "invoice:delete"
  | "comment:write"
  | "payment:view"
  | "payment:create"
  | "payment:delete"
  | "payment:plan"
  | "project:view"
  | "project:manage"
  | "user:manage"
  | "vendor:view"
  | "vendor:manage"
  | "category:manage"
  | "material:view"
  | "price:compare"
  | "report:view"
  | "budget:view"
  | "site:view"
  | "site:write"
  | "site:manage"
  | "request:view"
  | "request:write"
  | "request:approve"
  | "order:view"
  | "order:write"
  | "delivery:view"
  | "delivery:write"
  | "logs:view";

const ALL: Permission[] = [
  "dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "invoice:delete", "comment:write", "payment:view", "payment:create", "payment:delete",
  "payment:plan", "project:view", "project:manage", "user:manage", "vendor:view", "vendor:manage", "category:manage", "material:view", "price:compare",
  "report:view", "budget:view", "site:view", "site:write", "site:manage",
  "request:view", "request:write", "request:approve", "order:view", "order:write",
  "delivery:view", "delivery:write", "logs:view",
];

const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  ADMIN: new Set(ALL),
  ACCOUNTANT: new Set<Permission>([
    "dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "invoice:delete", "comment:write", "payment:view", "payment:create", "payment:delete", "payment:plan",
    "project:view", "vendor:view", "vendor:manage", "category:manage", "material:view", "price:compare", "report:view", "budget:view", "site:view",
    "request:view", "order:view", "delivery:view",
  ]),
  PURCHASE: new Set<Permission>(["dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "comment:write", "project:view", "vendor:view", "vendor:manage", "material:view", "price:compare", "site:view", "request:view", "request:write", "order:view", "order:write", "delivery:view", "delivery:write"]),
  MANAGER: new Set<Permission>(["dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "comment:write", "project:view", "budget:view", "material:view", "site:view", "site:write", "site:manage", "request:view", "request:write", "request:approve", "order:view", "delivery:view", "delivery:write"]),
  ENGINEER: new Set<Permission>(["dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "comment:write", "project:view", "site:view", "site:write", "request:view", "request:write", "delivery:view", "delivery:write"]),
  VIEWER: new Set<Permission>(["dashboard:view", "invoice:view", "project:view", "budget:view", "site:view", "request:view", "order:view", "delivery:view"]),
  // The original role: upload-first, view and review their own invoices, record payments on invoices they can access.
  STAFF: new Set<Permission>(["dashboard:view", "invoice:view", "invoice:upload", "invoice:review", "invoice:delete", "comment:write", "payment:create", "project:view"]),
};

export function hasPermission(role: RoleName | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const permissionsOf = (role: RoleName): Permission[] => [...(ROLE_PERMISSIONS[role] ?? [])];

/** Roles that see every project and every invoice in the company. Everyone else sees only the projects they are assigned to (and their own uploads). */
export const seesAllProjects = (role: RoleName | undefined | null): boolean => role === "ADMIN" || role === "ACCOUNTANT";

/** Roles that must be given projects when they are invited or edited, because they see nothing else. */
export const needsProjects = (role: RoleName): boolean => !seesAllProjects(role);

/**
 * Which permission opens a part of the app. The longest matching prefix wins. A path not listed here is open to everyone who
 * is signed in, except that a role that only sees its assigned projects may use only COMMON_PATHS (below) besides these.
 */
export const ROUTE_PERMISSIONS: { prefix: string; permission: Permission | "ADMIN_ONLY" }[] = [
  { prefix: "/payments/planner", permission: "payment:plan" },
  { prefix: "/payments", permission: "payment:view" },
  { prefix: "/api/reports/payables", permission: "payment:plan" },
  { prefix: "/reports/gst", permission: "report:view" },
  { prefix: "/api/reports/gst", permission: "report:view" },
  { prefix: "/materials/compare", permission: "price:compare" },
  { prefix: "/api/reports/price-compare", permission: "price:compare" },
  { prefix: "/materials", permission: "material:view" },
  { prefix: "/vendors", permission: "vendor:view" },
  { prefix: "/categories", permission: "category:manage" },
  { prefix: "/purchase/deliveries", permission: "delivery:view" },
  { prefix: "/purchase/orders", permission: "order:view" },
  { prefix: "/purchase", permission: "request:view" },
  { prefix: "/site", permission: "site:view" },
  { prefix: "/api/site", permission: "site:view" },
  { prefix: "/users", permission: "user:manage" },
  { prefix: "/admin", permission: "ADMIN_ONLY" },
  { prefix: "/plan", permission: "ADMIN_ONLY" },
  { prefix: "/api/master", permission: "ADMIN_ONLY" },
  { prefix: "/api/admin", permission: "ADMIN_ONLY" },
  { prefix: "/api/billing", permission: "ADMIN_ONLY" },
];

/** What every signed-in person may open besides their permissions: the home screens, their account and support. */
export const COMMON_PATHS = ["/dashboard", "/invoices", "/api/invoices", "/projects", "/account", "/support", "/locked", "/api/project-scope"];

const startsWithPath = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`);

/** Whether a role may open a path. Used by the sign-in guard; the pages and actions check again on their own. */
export function canOpenPath(role: RoleName | undefined | null, pathname: string): boolean {
  if (!role) return false;
  if (role === "ADMIN") return true;
  const rule = [...ROUTE_PERMISSIONS].sort((a, b) => b.prefix.length - a.prefix.length).find((r) => startsWithPath(pathname, r.prefix));
  if (rule) return rule.permission === "ADMIN_ONLY" ? false : hasPermission(role, rule.permission);
  if (seesAllProjects(role)) return true;
  return COMMON_PATHS.some((p) => startsWithPath(pathname, p));
}

/** Where a person is sent when they open something they may not: somewhere they can work. */
export const homeFor = (role: RoleName | undefined | null): string => (hasPermission(role, "invoice:upload") && !seesAllProjects(role) ? "/invoices/upload" : "/dashboard");
