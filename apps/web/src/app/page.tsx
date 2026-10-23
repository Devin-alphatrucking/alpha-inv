import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { FaqList } from "@/components/marketing/faq-list";
import { FEATURES, STEPS, faqs } from "@/lib/marketing/content";
import { landingEnabled } from "@/lib/marketing/pricing";
import { loadSite } from "@/lib/marketing/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: { absolute: "Purchase invoices, payments and GST in one place" },
  description: "Upload supplier invoices, have them read for you, track what you owe and what is due, watch project budgets, and file GST with confidence. Start a free trial.",
};

/**
 * The front door. Signed-in people go straight to their dashboard. Everyone else sees what the product does and what it costs
 * (set LANDING_PAGE=off on a deployment that is only one company's own app, and "/" goes to the sign-in page as before).
 */
export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  if (!landingEnabled(process.env.LANDING_PAGE)) redirect("/login");

  const site = await loadSite();
  const cta = site.signupOpen ? { href: "/signup", label: `Start your ${site.trialDays}-day free trial` } : { href: "/login", label: "Sign in" };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader name={site.name} signedIn={site.signedIn} signupOpen={site.signupOpen} />

      <main>
        <section className="relative overflow-hidden border-b border-border/60">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]" />
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
            <p className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">For builders, contractors and anyone who buys on invoice</p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Every supplier invoice, read, tracked and paid on time.</h1>
            <p className="max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              Upload invoices as PDFs or photos and they are read for you. See what you owe, what is overdue and how each project is spending against its budget. GST is ready when you are.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Button size="lg" className="h-12 gap-2 px-6 text-base" nativeButton={false} render={<Link href={cta.href} />}>
                {cta.label}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-6 text-base" nativeButton={false} render={<Link href="/pricing" />}>
                See pricing
              </Button>
            </div>
            {site.signupOpen && <p className="text-xs text-muted-foreground">No card needed to start.</p>}
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6" aria-labelledby="how">
          <h2 id="how" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border bg-card p-5">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="border-y border-border/60 bg-muted/30" aria-labelledby="features-title">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="features-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Everything you need to stay on top of purchases</h2>
            <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">All of it is in every plan.</p>
            <ul className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-2xl border bg-card p-5">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="pricing-title">
          <h2 id="pricing-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Simple pricing</h2>
          <p className="mx-auto mb-9 mt-2 max-w-xl text-center text-sm text-muted-foreground">One plan per project.{site.signupOpen ? ` Try it free for ${site.trialDays} days, then pick a plan to keep going.` : ""}</p>
          <PricingCards plans={site.plans} trialDays={site.trialDays} signupOpen={site.signupOpen} supportEmail={site.supportEmail} />
        </section>

        <section className="border-t border-border/60 bg-muted/30" aria-labelledby="faq-title">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="faq-title" className="mb-8 text-center text-2xl font-semibold tracking-tight sm:text-3xl">Questions</h2>
            <FaqList items={faqs(site.trialDays)} />
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Spend an afternoon on it, not every month-end.</h2>
          <Button size="lg" className="h-12 gap-2 px-6 text-base" nativeButton={false} render={<Link href={cta.href} />}>
            {cta.label}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </section>
      </main>

      <SiteFooter name={site.name} supportEmail={site.supportEmail} terms={site.legal.terms} privacy={site.legal.privacy} />
    </div>
  );
}
