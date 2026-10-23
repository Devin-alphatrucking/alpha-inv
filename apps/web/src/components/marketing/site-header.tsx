import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Top bar of the public pages. */
export function SiteHeader({ name, signedIn, signupOpen }: { name: string; signedIn: boolean; signupOpen: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {name}
        </Link>
        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-2" aria-label="Main">
          <Link href="/#features" className="hidden rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline">
            Features
          </Link>
          <Link href="/pricing" className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:px-2.5">
            Pricing
          </Link>
          {signedIn ? (
            <Button size="sm" nativeButton={false} render={<Link href="/dashboard" />}>
              Open app
            </Button>
          ) : (
            <>
              <Link href="/login" className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:px-2.5">
                Sign in
              </Link>
              {signupOpen && (
                <Button size="sm" nativeButton={false} render={<Link href="/signup" />}>
                  <span className="sm:hidden">Try free</span>
                  <span className="hidden sm:inline">Start free trial</span>
                </Button>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
