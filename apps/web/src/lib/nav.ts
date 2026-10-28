import { canOpenPath, hasPermission, seesAllProjects, type Permission, type RoleName } from "@/lib/roles";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Building2,
  Boxes,
  Tags,
  Wallet,
  Users,
  FolderKanban,
  ScrollText,
  Bug,
  Settings,
  CreditCard,
  LifeBuoy,
  Receipt,
  CalendarRange,
  Scale,
  HardHat,
  ShoppingCart,
  BarChart3,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to roles that hold this permission (see lib/roles.ts). */
  permission?: Permission;
  /** "all": only roles that see every project (the label says "Invoices"); "assigned": only roles limited to their projects ("My Invoices"). */
  scope?: "all" | "assigned";
  /** Which part of the sidebar: the top, the Accounts block (our main module), the other modules, or pinned at the bottom. */
  group: "top" | "accounts" | "modules" | "bottom";
  /** Whether this item is the current place, for a given address. */
  active: (pathname: string) => boolean;
};

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const isUpload = (p: string) => p.startsWith("/invoices/upload") || (p.startsWith("/invoices") && p.includes("/review"));

/**
 * The sidebar, kept short on purpose. Accounts (our main module) comes first, then the other modules. Everything that
 * is set up once and rarely changed (people, projects, categories, plan, logs) lives behind Settings, and the
 * reports and tools behind Reports.
 */
export const NAV_ITEMS: NavItem[] = [
  { group: "top", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view", active: (p) => p === "/dashboard" },

  { group: "accounts", href: "/invoices/upload", label: "Upload invoice", icon: Upload, permission: "invoice:upload", active: isUpload },
  { group: "accounts", href: "/invoices", label: "My invoices", icon: FileText, permission: "invoice:view", scope: "assigned", active: (p) => under(p, "/invoices") && !isUpload(p) },
  { group: "accounts", href: "/invoices", label: "Invoices", icon: FileText, permission: "invoice:view", scope: "all", active: (p) => under(p, "/invoices") && !isUpload(p) },
  { group: "accounts", href: "/payments", label: "Payments", icon: Wallet, permission: "payment:view", active: (p) => under(p, "/payments") && !under(p, "/payments/planner") },
  { group: "accounts", href: "/vendors", label: "Vendors", icon: Building2, permission: "vendor:view", active: (p) => under(p, "/vendors") },
  { group: "accounts", href: "/reports", label: "Reports & tools", icon: BarChart3, active: (p) => under(p, "/reports") || under(p, "/materials") || under(p, "/payments/planner") },

  { group: "modules", href: "/purchase", label: "Purchase", icon: ShoppingCart, permission: "request:view", active: (p) => under(p, "/purchase") },
  { group: "modules", href: "/site", label: "Site work", icon: HardHat, permission: "site:view", active: (p) => under(p, "/site") },

  { group: "bottom", href: "/settings", label: "Settings", icon: Settings, active: (p) => ["/settings", "/users", "/projects", "/categories", "/plan", "/support", "/admin"].some((x) => under(p, x)) },
];

export const GROUP_LABEL: Record<NavItem["group"], string | null> = { top: null, accounts: "Accounts", modules: "Other modules", bottom: null };

/** A link on a hub page (Settings, Reports & tools): where it goes, and what it is for. */
export type HubLink = { href: string; label: string; description: string; icon: LucideIcon };

export const SETTINGS_LINKS: HubLink[] = [
  { href: "/users", label: "Team and roles", description: "Invite people and choose what each can do", icon: Users },
  { href: "/projects", label: "Projects", description: "Sites, who is on them, spend and budgets", icon: FolderKanban },
  { href: "/categories", label: "Categories", description: "Material categories and units", icon: Tags },
  { href: "/admin/settings", label: "Company settings", description: "Name, logo, colours, limits and data reset", icon: Settings },
  { href: "/plan", label: "Plan and billing", description: "Your plan, usage and payments", icon: CreditCard },
  { href: "/admin/activity", label: "Activity log", description: "Who did what, and when", icon: ScrollText },
  { href: "/admin/errors", label: "Error log", description: "Problems with the request id to quote", icon: Bug },
  { href: "/support", label: "Help and support", description: "Ask us a question or report a problem", icon: LifeBuoy },
  { href: "/account", label: "My account", description: "Your password, two-step sign-in and emails", icon: UserRound },
];

export const REPORT_LINKS: HubLink[] = [
  { href: "/payments/planner", label: "Payment planner", description: "What falls due, and pay several bills at once", icon: CalendarRange },
  { href: "/reports/gst", label: "GST report", description: "Tax by month and supplier, with CSV", icon: Receipt },
  { href: "/reports/purchase", label: "Purchase report", description: "Ordered, delivered, billed and paid; suppliers", icon: BarChart3 },
  { href: "/materials", label: "Rate sheet", description: "Live material rates and averages", icon: Boxes },
  { href: "/materials/compare", label: "Price comparison", description: "Who sells the same item cheaper", icon: Scale },
];

/** The links of a hub page this role may open (the same table the sign-in guard uses). */
export const hubLinksFor = (links: HubLink[], role: RoleName) => links.filter((l) => canOpenPath(role, l.href));

export function getNavItemsForRole(role: RoleName): NavItem[] {
  const visible = NAV_ITEMS.filter((item) => {
    if (item.permission && !hasPermission(role, item.permission)) return false;
    if (item.scope === "all" && !seesAllProjects(role)) return false;
    if (item.scope === "assigned" && seesAllProjects(role)) return false;
    return true;
  });
  // A hub is shown only when the role can open at least one thing inside it.
  return visible.filter((item) => (item.href === "/settings" ? hubLinksFor(SETTINGS_LINKS, role).length > 0 : item.href === "/reports" ? hubLinksFor(REPORT_LINKS, role).length > 0 : true));
}
