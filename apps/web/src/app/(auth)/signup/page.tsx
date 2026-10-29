import { Suspense } from "react";
import Link from "next/link";
import { AuthShell, legalLinks } from "@/components/auth-shell";
import { isEmailConfigured } from "@/lib/email/transport";
import { COUNTRY_DEFAULTS } from "@/lib/org/starter-data";
import { SignUpForm } from "./signup-form";
import { GoogleButton } from "@/components/google-button";
import { isGoogleConfigured } from "@/lib/flows/google";

export const metadata = { title: "Create your company account" };

export default async function SignUpPage() {
  const open = process.env.SIGNUP_ENABLED !== "false" && isEmailConfigured();
  // Google sign-up needs no emailed code, so it is offered whenever sign-up is not switched off.
  const google = process.env.SIGNUP_ENABLED !== "false" && isGoogleConfigured();
  const links = legalLinks();
  return (
    <AuthShell
      title="Create your company account"
      subtitle="Start a free trial. You will confirm your email, then set up your team."
      points={[
        { title: "Accounts, site work and purchase in one place", text: "Invoices, payments, vendors, materials and site issues, with one team and one set of reports." },
        { title: "14-day free trial", text: "Set up your company in minutes. Nothing is charged until you choose a plan." },
        { title: "Your data stays yours", text: "Every company is kept apart from every other. Your team only sees what its role allows." },
      ]}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
            Sign in
          </Link>
          <span className="mt-1 block">Already work for another company on this app? Sign in, then use the company menu at the top: Start a company of your own. One sign-in, separate companies.</span>
        </>
      }
    >
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Create your account</h2>
      {google && (
        <Suspense fallback={null}>
          <div className="mb-5 grid gap-2">
            <GoogleButton label="Sign up with Google" />
            <p className="text-center text-xs text-muted-foreground">
              Continuing with Google creates your company on a free trial and means you accept the{" "}
              {links.terms ? <a href={links.terms} className="underline underline-offset-2" target="_blank" rel="noreferrer">terms</a> : "terms"} and{" "}
              {links.privacy ? <a href={links.privacy} className="underline underline-offset-2" target="_blank" rel="noreferrer">privacy policy</a> : "privacy policy"}.
            </p>
            {open && (
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                or use your email
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
          </div>
        </Suspense>
      )}
      {open ? (
        <SignUpForm
          countries={Object.entries(COUNTRY_DEFAULTS).map(([code, c]) => ({ code, label: c.label }))}
          termsUrl={links.terms}
          privacyUrl={links.privacy}
        />
      ) : !google ? (
        <p className="text-sm text-muted-foreground">
          Self-service sign-up is not available right now. Ask your administrator to invite you.
        </p>
      ) : null}
    </AuthShell>
  );
}
