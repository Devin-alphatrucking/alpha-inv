import { ChevronDown } from "lucide-react";
import type { Faq } from "@/lib/marketing/content";

/** Questions people ask before signing up. Plain details/summary: works without JavaScript and with a keyboard. */
export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-2.5">
      {items.map((f) => (
        <details key={f.q} className="group rounded-xl border bg-card px-4 py-3.5 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {f.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
