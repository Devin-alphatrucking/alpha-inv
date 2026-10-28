import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { HubLink } from "@/lib/nav";

/** A plain page of links with a line about each: the landing page of Settings and of Reports & tools. */
export function HubLinks({ title, intro, links }: { title: string; intro: string; links: HubLink[] }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <li key={l.href}>
              <Link href={l.href} className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{l.label}</span>
                  <span className="block text-xs text-muted-foreground">{l.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
