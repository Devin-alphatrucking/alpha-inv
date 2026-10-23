import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { MasterNav } from "./master-client";

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
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
            <span className="font-semibold">Master console</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{admin.email}</span>
            <Link href="/dashboard" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              <ArrowLeft className="size-3.5" aria-hidden /> Back to app
            </Link>
          </div>
          <div className="w-full">
            <MasterNav />
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
