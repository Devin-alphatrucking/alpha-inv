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
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to ADMIN */
  adminOnly?: boolean;
  /** Shown only to STAFF (and ADMIN if not adminOnly) */
  staffOnly?: boolean;
};

/**
 * STAFF: upload + their invoices (pending review / uploads) + assigned projects.
 * ADMIN: full navigation.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices/upload", label: "Upload Invoice", icon: Upload },
  { href: "/invoices", label: "My Invoices", icon: FileText, staffOnly: true },
  { href: "/invoices", label: "Invoices", icon: FileText, adminOnly: true },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/payments", label: "Payments", icon: Wallet, adminOnly: true },
  { href: "/materials", label: "Rate Sheet", icon: Boxes, adminOnly: true },
  { href: "/vendors", label: "Vendors", icon: Building2, adminOnly: true },
  { href: "/categories", label: "Categories", icon: Tags, adminOnly: true },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/admin/activity", label: "Activity Logs", icon: ScrollText, adminOnly: true },
  { href: "/admin/errors", label: "Error Logs", icon: Bug, adminOnly: true },
  { href: "/plan", label: "Plan & usage", icon: CreditCard, adminOnly: true },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function getNavItemsForRole(role: "ADMIN" | "STAFF") {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return role === "ADMIN";
    if (item.staffOnly) return role === "STAFF";
    return true;
  });
}

/** Paths STAFF may access (prefix match). Everything else redirects to upload. */
export const STAFF_ALLOWED_PREFIXES = [
  "/dashboard",
  "/invoices",
  "/api/invoices",
  "/projects",
  "/account",
  "/support",
];

export const ADMIN_ONLY_PREFIXES = [
  "/payments",
  "/vendors",
  "/categories",
  "/materials",
  "/users",
  "/admin",
  "/plan",
];
