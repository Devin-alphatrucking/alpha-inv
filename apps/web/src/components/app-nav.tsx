"use client";

import { ROLE_INFO, type RoleName } from "@/lib/roles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, getNavItemsForRole, type NavItem } from "@/lib/nav";
import type { AddonKey } from "@/lib/addons";

type AppNavProps = {
  role: RoleName;
  onNavigate?: () => void;
  className?: string;
  addons?: AddonKey[];
};

/** The sidebar: Dashboard, then Accounts (our main module), then the other modules; Settings is pinned at the bottom. */
export function AppNav({ role, onNavigate, className, addons = [] }: AppNavProps) {
  const pathname = usePathname();
  const items = getNavItemsForRole(role, addons);
  const groups: NavItem["group"][] = ["top", "accounts", "modules"];
  const bottom = items.filter((i) => i.group === "bottom");

  const link = (item: NavItem) => {
    const isActive = item.active(pathname);
    const Icon = item.icon;
    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
          isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className={cn("flex h-full flex-col gap-4", className)}>
      {role !== "ADMIN" && <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{ROLE_INFO[role].label}</p>}
      {groups.map((g) => {
        const group = items.filter((i) => i.group === g);
        if (group.length === 0) return null;
        const label = GROUP_LABEL[g];
        return (
          <div key={g} className="grid gap-0.5">
            {label && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>}
            {group.map(link)}
          </div>
        );
      })}
      {bottom.length > 0 && <div className="mt-auto grid gap-0.5 border-t border-sidebar-border pt-3">{bottom.map(link)}</div>}
    </nav>
  );
}
