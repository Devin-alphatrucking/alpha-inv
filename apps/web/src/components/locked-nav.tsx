"use client";

import type { RoleName } from "@/lib/roles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, LifeBuoy, Lock, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/** The only places a locked company can go: choose a plan, billing, support, and its own account. Used in the side menu and as the phone bar. */
export function LockedNav({ role, variant }: { role: RoleName; variant: "side" | "bar" }) {
  const pathname = usePathname();
  const items = [
    { href: "/locked", label: "Choose a plan", icon: Lock },
    ...(role === "ADMIN" ? [{ href: "/plan", label: "Billing", icon: CreditCard }] : []),
    { href: "/support", label: "Support", icon: LifeBuoy },
    { href: "/account", label: "Account", icon: UserRound },
  ];

  if (variant === "bar") {
    return (
      <nav aria-label="Locked company navigation" className="fixed right-0 bottom-0 left-0 z-50 border-t border-border/70 bg-background/95 backdrop-blur-lg md:hidden pb-safe">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={cn("flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium", active ? "font-semibold text-primary" : "text-muted-foreground")}>
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      <p className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Locked until a plan is active</p>
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
