import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanView } from "@/lib/marketing/pricing";

/** The plan(s) on sale. A plan whose price is not set yet says so honestly and still leads to the free trial. */
export function PricingCards({ plans, trialDays, signupOpen, supportEmail }: { plans: PlanView[]; trialDays: number; signupOpen: boolean; supportEmail: string | null }) {
  if (plans.length === 0) {
    return (
      <p className="mx-auto max-w-md rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        Plans are being set up. {supportEmail ? <>Write to <a className="underline underline-offset-4" href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will help.</> : "Please check back soon."}
      </p>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
      {plans.map((p) => (
        <section key={p.code} className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm" aria-label={p.name}>
          <h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="mt-3 flex items-baseline gap-1.5">
            {p.price ? (
              <>
                <span className="text-4xl font-semibold tracking-tight tabular-nums">{p.price}</span>
                <span className="text-sm text-muted-foreground">{p.per}</span>
              </>
            ) : (
              <span className="text-2xl font-semibold tracking-tight">Price on request</span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{p.price ? "for each project you run" : "Start the free trial now; the price is confirmed before you pay."}</p>
          <ul className="mt-5 grid gap-2.5 text-sm">
            {p.features.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            {signupOpen ? (
              <Button className="w-full" size="lg" nativeButton={false} render={<Link href="/signup" />}>
                Start your {trialDays}-day free trial
              </Button>
            ) : (
              <Button className="w-full" size="lg" variant="outline" nativeButton={false} render={<Link href="/login" />}>
                Sign in
              </Button>
            )}
            {signupOpen && <p className="mt-2 text-center text-xs text-muted-foreground">No card needed to start.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
