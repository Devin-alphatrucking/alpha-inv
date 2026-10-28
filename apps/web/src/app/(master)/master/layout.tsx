import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { PRODUCT_NAME } from "@/lib/brand/product";
import { Input } from "@/components/ui/input";
import { MasterNav } from "./master-client";
import { MasterSideNav } from "./side-nav";

export const metadata: Metadata = { title: "Master console", robots: { index: false, follow: false } };

// Everything under /master is for our own team only. Anyone else gets a plain 404.
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const admin = await pagePlatformAdmin();
  if (!admin.twoStep) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Turn on two-step sign-in first</h1>
        <p className="text-sm text-muted-foreground">
          The master console can change plans, prices and access for every company, so it needs a password AND a code from an authenticator app.
          Turn it on, then come back here.
        </p>
        <div className="flex gap-3">
          <Link href="/account" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">
            Open my account
          </Link>
          <Link href="/dashboard" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium">
            Back to app
          </Link>
        </div>
      </main>
    );
  }
  return (
    <div className="flex min-h-dvh bg-muted/30">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="border-b border-sidebar-border px-5 py-5">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
            {PRODUCT_NAME}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Master console</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <MasterSideNav />
        </div>
        <div className="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
          <p className="truncate px-1 pb-2">{admin.email}</p>
          <Link href="/dashboard" className="inline-flex items-center gap-1 px-1 underline-offset-4 hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to app
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b bg-background">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <p className="flex items-center gap-2 font-semibold md:hidden">
              <ShieldCheck className="size-5 text-primary" aria-hidden /> Master
            </p>
            <form action="/master/companies" method="get" role="search" className="relative ml-auto w-full max-w-sm md:ml-0">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input name="q" type="search" aria-label="Find a company" placeholder="Find a company by name or code" className="pl-9" />
            </form>
            <Link href="/dashboard" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline md:hidden">
              App
            </Link>
          </div>
          <div className="px-4 pb-2 sm:px-6 md:hidden">
            <MasterNav />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
