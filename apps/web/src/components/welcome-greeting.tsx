"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Set by the sign-in and sign-up screens just before they open the app, so the greeting shows once, on arrival. */
export const WELCOME_KEY = "app-welcome";
export type WelcomeKind = "new" | "back";

export function rememberWelcome(kind: WelcomeKind) {
  try {
    sessionStorage.setItem(WELCOME_KEY, kind);
  } catch {
    // private window or blocked storage: the greeting is a nicety, so skip it
  }
}

/** A small card that fades in after signing in ("Welcome back, Ravi") or after sign-up ("Welcome, Ravi. Your 14-day trial has started"), then fades out. */
export function WelcomeGreeting({ name, company }: { name: string; company: string }) {
  const [kind, setKind] = useState<WelcomeKind | null>(null);
  // `visible` flips a moment after the card is mounted, so the card eases in from its resting-off state and eases out again.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let found: WelcomeKind | null = null;
    try {
      const v = sessionStorage.getItem(WELCOME_KEY);
      if (v === "new" || v === "back") found = v;
    } catch {
      // nothing to show
    }
    if (!found) return;
    const kindToShow = found;
    // Only used up once it is actually shown, so a development double-run of this effect cannot lose it.
    const show = setTimeout(() => {
      try {
        sessionStorage.removeItem(WELCOME_KEY);
      } catch {
        // ignore
      }
      setKind(kindToShow);
    }, 60);
    const fadeIn = setTimeout(() => setVisible(true), 140);
    const out = setTimeout(() => setVisible(false), 4600);
    const gone = setTimeout(() => setKind(null), 5100);
    return () => {
      clearTimeout(show);
      clearTimeout(fadeIn);
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, []);

  if (!kind) return null;
  const first = name.trim().split(/\s+/)[0] || name;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center px-4 print:hidden" role="status" aria-live="polite">
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-background p-4 shadow-xl transition-all duration-500 ease-out",
          visible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-3 scale-95 opacity-0",
        )}
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{kind === "new" ? `Welcome, ${first}!` : `Welcome back, ${first}`}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {kind === "new" ? `${company} is ready and your free trial has started. Add your first invoice or invite your team.` : `You are in ${company}.`}
          </p>
        </div>
        <button type="button" onClick={() => setVisible(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
