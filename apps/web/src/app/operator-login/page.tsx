import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { OperatorLoginForm } from "./operator-login-form";

export const metadata = { title: "Operator sign-in", robots: { index: false, follow: false } };

export default function OperatorLoginPage() {
  // In production this screen exists only on the master address (MASTER_HOST); without one, operators keep using the normal sign-in.
  if (process.env.NODE_ENV === "production" && !process.env.MASTER_HOST?.trim()) notFound();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <AuthBackdrop />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" aria-hidden /></span>
          <h1 className="text-2xl font-semibold tracking-tight">Operator sign-in</h1>
          <p className="mt-2 text-sm text-muted-foreground">For our own team. You need your password and the code from your authenticator app.</p>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border bg-card/80" />}>
          <OperatorLoginForm />
        </Suspense>
      </div>
    </div>
  );
}
