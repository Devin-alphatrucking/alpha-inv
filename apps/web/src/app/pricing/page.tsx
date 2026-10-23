import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { FaqList } from "@/components/marketing/faq-list";
import { faqs } from "@/lib/marketing/content";
import { loadSite } from "@/lib/marketing/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pricing",
  description: "One plan per project, every feature included. Start with a free trial, then choose a plan to keep going.",
};

/** What it costs, what one plan includes, and the questions people ask first. Open to everyone, signed in or not. */
export default async function PricingPage() {
  const site = await loadSite();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader name={site.name} signedIn={site.signedIn} signupOpen={site.signupOpen} />
      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-14 sm:px-6">
          <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-5xl">Simple pricing</h1>
          <p className="mx-auto mb-10 mt-3 max-w-xl text-center text-base text-muted-foreground">
            One plan covers one project. Every feature is included.{site.signupOpen ? ` Try it free for ${site.trialDays} days.` : ""}
          </p>
          <PricingCards plans={site.plans} trialDays={site.trialDays} signupOpen={site.signupOpen} supportEmail={site.supportEmail} />
          <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">Running more than one project? Buy another plan for each one, any time, from the Plan page inside the app.</p>
        </section>
        <section className="border-t border-border/60 bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">Questions</h2>
            <FaqList items={faqs(site.trialDays)} />
          </div>
        </section>
      </main>
      <SiteFooter name={site.name} supportEmail={site.supportEmail} terms={site.legal.terms} privacy={site.legal.privacy} />
    </div>
  );
}
