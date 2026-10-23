/**
 * Soft background for the sign-in and account-recovery pages. It uses the theme colours (the page background and the company's
 * main colour), so it is readable in BOTH light and dark mode. A fixed light gradient made the white heading invisible in dark mode.
 */
export function AuthBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-background bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_62%)]"
    />
  );
}
