import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { BrandLogo } from "@/components/brand-logo";
import { getBrand } from "@/lib/brand/brand";
import { isEmailConfigured } from "@/lib/email/transport";

export default async function LoginPage() {
  const brand = await getBrand();
  const signupEnabled = process.env.SIGNUP_ENABLED !== "false" && isEmailConfigured();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <AuthBackdrop />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 text-center sm:mb-10">
          {brand.logoUrl ? (
            <div className="mb-4 flex justify-center">
              <BrandLogo name={brand.name} logoUrl={brand.logoUrl} className="h-12 max-w-[220px]" />
            </div>
          ) : (
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {brand.isDefault ? "Welcome" : brand.name}
            </p>
          )}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Invoice &amp; Billing
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Upload and track purchase invoices
          </p>
        </div>
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-2xl border bg-card/80" />
          }
        >
          <LoginForm signupEnabled={signupEnabled} />
        </Suspense>
        {(brand.supportEmail || brand.supportUrl) && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Need help?{" "}
            {brand.supportEmail && (
              <a className="underline underline-offset-2" href={`mailto:${brand.supportEmail}`}>
                {brand.supportEmail}
              </a>
            )}
            {brand.supportEmail && brand.supportUrl ? " · " : ""}
            {brand.supportUrl && (
              <a className="underline underline-offset-2" href={brand.supportUrl} target="_blank" rel="noreferrer">
                Support site
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
