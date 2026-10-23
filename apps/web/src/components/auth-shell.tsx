import { BrandLogo } from "@/components/brand-logo";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { getBrand } from "@/lib/brand/brand";

/** Centered card used by sign-up, password reset, verification and invitation pages. */
export async function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const brand = await getBrand();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <AuthBackdrop />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 text-center">
          <div className="mb-3 flex justify-center">
            <BrandLogo name={brand.name} logoUrl={brand.logoUrl} className="h-10 max-w-[200px]" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

/** Links to your legal pages, taken from TERMS_URL and PRIVACY_URL (only https addresses are used). */
export function legalLinks() {
  const ok = (v?: string) => (v && /^https:\/\//.test(v) ? v : null);
  return { terms: ok(process.env.TERMS_URL), privacy: ok(process.env.PRIVACY_URL) };
}
