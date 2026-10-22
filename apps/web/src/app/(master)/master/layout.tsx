import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { pagePlatformAdmin } from "@/lib/master/guard";
import { MasterNav } from "./master-client";

export const metadata: Metadata = { title: "Master console", robots: { index: false, follow: false } };

// Everything under /master is for our own team only. Anyone else gets a plain 404.
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const admin = await pagePlatformAdmin();
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
