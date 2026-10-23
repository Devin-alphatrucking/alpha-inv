import Link from "next/link";

/** Bottom of the public pages: where to go, how to reach support, and the legal pages when they are set up. */
export function SiteFooter({ name, supportEmail, terms, privacy }: { name: string; supportEmail: string | null; terms: string | null; privacy: string | null }) {
  const link = "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-muted-foreground">&copy; {new Date().getFullYear()} {name}</p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
          <Link href="/pricing" className={link}>Pricing</Link>
          <Link href="/login" className={link}>Sign in</Link>
          {supportEmail && <a href={`mailto:${supportEmail}`} className={link}>Contact us</a>}
          {terms && <a href={terms} className={link} rel="noopener noreferrer">Terms</a>}
          {privacy && <a href={privacy} className={link} rel="noopener noreferrer">Privacy</a>}
        </nav>
      </div>
    </footer>
  );
}
