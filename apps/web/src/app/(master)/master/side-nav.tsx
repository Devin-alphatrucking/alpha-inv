"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, LayoutDashboard, LifeBuoy, ListChecks, ScrollText, Tag, Users2 } from "lucide-react";
import { cn } from "@/lib/utils";

const GROUPS: { label: string | null; items: { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] }[] = [
  { label: null, items: [{ href: "/master", label: "Overview", icon: LayoutDashboard, exact: true }] },
  {
    label: "Clients",
    items: [
      { href: "/master/companies", label: "Companies", icon: Users2 },
      { href: "/master/follow-ups", label: "Follow-ups", icon: ListChecks },
      { href: "/master/tickets", label: "Support tickets", icon: LifeBuoy },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/master/billing", label: "Billing", icon: CreditCard },
      { href: "/master/plans", label: "Plans and prices", icon: Tag },
    ],
  },
  { label: "System", items: [{ href: "/master/logs", label: "Logs", icon: ScrollText }] },
];

/** The console's side menu: same look as the product's own. On phones the same links sit in a scrolling row (see MasterNav). */
export function MasterSideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Master console" className="grid gap-4">
      {GROUPS.map((g, i) => (
        <div key={i} className="grid gap-0.5">
          {g.label && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>}
          {g.items.map((item) => {
            const active = item.exact ? path === item.href : path.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

