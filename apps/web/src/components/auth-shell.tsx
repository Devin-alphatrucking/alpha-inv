import { BrandLogo } from "@/components/brand-logo";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { getBrand } from "@/lib/brand/brand";

/**
 * Card used by sign-up, password reset, verification and invitation pages.
 * Narrow (default): one centred card. Wide (`points` given, used by sign-up): on a desktop the introduction sits on the left and the
 * form on the right, so a long form fits one screen; on a phone it stacks with the introduction first.
 */
export async function AuthShell({
  title,
  subtitle,
  children,
  footer,
  points,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Short reasons to sign up, shown beside the form on a desktop. Makes the layout wide. */
  points?: { title: string; text: string }[];
}) {
  const brand = await getBrand();
  const logo = <BrandLogo name={brand.name} logoUrl={brand.logoUrl} className="h-10 max-w-[200px]" />;

  if (!points) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <AuthBackdrop />
        <div className="relative w-full max-w-[420px]">
          <div className="mb-6 text-center">
            <div className="mb-3 flex justify-center">{logo}</div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">{children}</div>
          {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:py-6">
      <AuthBackdrop />
      <div className="relative grid w-full max-w-[1040px] items-center gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-12">
        <div className="text-center lg:text-left">
          <div className="mb-3 flex justify-center lg:justify-start">{logo}</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground lg:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground lg:text-base">{subtitle}</p>}
          <ul className="mt-6 hidden gap-4 lg:grid">
            {points.map((p) => (
              <li key={p.title} className="border-l-2 border-primary/40 pl-4">
                <p className="text-sm font-semibold text-foreground">{p.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>
          {footer && <div className="mt-8 hidden text-sm text-muted-foreground lg:block">{footer}</div>}
        </div>
        <div>
          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-7">{children}</div>
          {footer && <div className="mt-4 text-center text-sm text-muted-foreground lg:hidden">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/** Links to your legal pages, taken from TERMS_URL and PRIVACY_URL (only https addresses are used). */
export function legalLinks() {
  const ok = (v?: string) => (v && /^https:\/\//.test(v) ? v : null);
  return { terms: ok(process.env.TERMS_URL), privacy: ok(process.env.PRIVACY_URL) };
}
