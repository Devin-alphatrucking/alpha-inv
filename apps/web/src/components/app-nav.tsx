"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getNavItemsForRole } from "@/lib/nav";

type AppNavProps = {
  role: "ADMIN" | "STAFF";
  onNavigate?: () => void;
  className?: string;
};

export function AppNav({ role, onNavigate, className }: AppNavProps) {
  const pathname = usePathname();
  const items = getNavItemsForRole(role);

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {role === "STAFF" && (
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Staff · Upload focus
        </p>
      )}
      {items.map((item) => {
        const isActive =
          item.href === "/invoices/upload"
            ? pathname.startsWith("/invoices/upload") ||
              pathname.includes("/review")
            : pathname === item.href ||
              (item.href !== "/invoices" && pathname.startsWith(`${item.href}/`)) ||
              (item.href === "/invoices" &&
                pathname.startsWith("/invoices") &&
                !pathname.startsWith("/invoices/upload") &&
                !pathname.includes("/review"));
        const Icon = item.icon;
        return (
          <Link
            key={`${item.href}-${item.label}`}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground hover:translate-x-0.5"
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 transition-transform duration-200",
                !isActive && "group-hover:scale-110"
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
