"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/sales", label: "Invoices", match: (p: string) => p === "/sales" || p.startsWith("/sales/new") || /^\/sales\/(?!customers|reports|settings)[^/]+/.test(p) },
  { href: "/sales/customers", label: "Customers", match: (p: string) => p.startsWith("/sales/customers") },
  { href: "/sales/reports", label: "Downloads", match: (p: string) => p.startsWith("/sales/reports") },
  { href: "/sales/settings", label: "Settings", match: (p: string) => p.startsWith("/sales/settings") },
];

export function SalesTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sales" className="flex gap-1 overflow-x-auto border-b print:hidden">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
