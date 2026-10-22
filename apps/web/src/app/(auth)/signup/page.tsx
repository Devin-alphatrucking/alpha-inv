import Link from "next/link";
import { AuthShell, legalLinks } from "@/components/auth-shell";
import { isEmailConfigured } from "@/lib/email/transport";
import { COUNTRY_DEFAULTS } from "@/lib/org/starter-data";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Create your company account" };

export default async function SignUpPage() {
  const open = process.env.SIGNUP_ENABLED !== "false" && isEmailConfigured();
  const links = legalLinks();
  return (
    <AuthShell
      title="Create your company account"
      subtitle="Start a free trial. You will confirm your email, then set up your team."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      {open ? (
        <SignUpForm
          countries={Object.entries(COUNTRY_DEFAULTS).map(([code, c]) => ({ code, label: c.label }))}
          termsUrl={links.terms}
          privacyUrl={links.privacy}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Self-service sign-up is not available right now. Ask your administrator to invite you.
        </p>
      )}
    </AuthShell>
  );
}
