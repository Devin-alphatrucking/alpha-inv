import { hasPermission, seesAllProjects, type Permission, type RoleName } from "@/lib/roles";
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
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to roles that hold this permission (see lib/roles.ts). */
  permission?: Permission;
  /** Shown only to the administrator (plans and settings are the owner's). */
  adminOnly?: boolean;
  /** "all": only roles that see every project (the label says "Invoices"); "assigned": only roles limited to their projects ("My Invoices"). */
  scope?: "all" | "assigned";
};

/** The sidebar. Which items a person sees follows their role's permissions; the sign-in guard enforces the same table. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/invoices/upload", label: "Upload Invoice", icon: Upload, permission: "invoice:upload" },
  { href: "/invoices", label: "My Invoices", icon: FileText, permission: "invoice:view", scope: "assigned" },
  { href: "/invoices", label: "Invoices", icon: FileText, permission: "invoice:view", scope: "all" },
  { href: "/projects", label: "Projects", icon: FolderKanban, permission: "project:view" },
  { href: "/purchase", label: "Purchase", icon: ShoppingCart, permission: "request:view" },
  { href: "/site", label: "Site work", icon: HardHat, permission: "site:view" },
  { href: "/payments", label: "Payments", icon: Wallet, permission: "payment:view" },
  { href: "/payments/planner", label: "Payment planner", icon: CalendarRange, permission: "payment:plan" },
  { href: "/reports/gst", label: "GST report", icon: Receipt, permission: "report:view" },
  { href: "/materials", label: "Rate Sheet", icon: Boxes, permission: "material:view" },
  { href: "/materials/compare", label: "Price comparison", icon: Scale, permission: "price:compare" },
  { href: "/vendors", label: "Vendors", icon: Building2, permission: "vendor:view" },
  { href: "/categories", label: "Categories", icon: Tags, permission: "category:manage" },
  { href: "/users", label: "Users", icon: Users, permission: "user:manage" },
  { href: "/admin/activity", label: "Activity Logs", icon: ScrollText, permission: "logs:view" },
  { href: "/admin/errors", label: "Error Logs", icon: Bug, permission: "logs:view" },
  { href: "/plan", label: "Plan & usage", icon: CreditCard, adminOnly: true },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function getNavItemsForRole(role: RoleName) {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly && role !== "ADMIN") return false;
    if (item.permission && !hasPermission(role, item.permission)) return false;
    if (item.scope === "all" && !seesAllProjects(role)) return false;
    if (item.scope === "assigned" && seesAllProjects(role)) return false;
    return true;
  });
}
