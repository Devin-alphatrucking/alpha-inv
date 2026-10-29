"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/code-input";
import { rememberWelcome } from "@/components/welcome-greeting";
import { confirmEmailCodeAction, resendVerificationAction } from "./actions";

/** "Enter the 6-digit code we emailed you" to confirm an address (after sign-up, or from the confirm page). */
export function EmailCodeForm({ email, password }: { email: string; password?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // After the code is right and a password is at hand: "going in" while we sign the person in, "manual" if that did not work.
  const [entering, setEntering] = useState<"going-in" | "manual" | null>(null);
  const [wait, setWait] = useState(30);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    start(async () => {
      const r = await confirmEmailCodeAction(email, code);
      if (r.ok) {
        setDone(true);
        // Just signed up: the password is still in this page, so go straight in instead of asking for it again.
        if (password) {
          setEntering("going-in");
          const [signedIn] = await Promise.all([
            signIn("credentials", { email, password, totp: "", redirect: false }).catch(() => null),
            new Promise((resolve) => setTimeout(resolve, 1400)), // let the "confirmed" animation be seen
          ]);
          if (signedIn && !signedIn.error) {
            rememberWelcome("new");
            window.location.assign("/");
            return;
          }
          setEntering("manual");
        }
      } else {
        setError(r.error);
        setCode("");
      }
    });
  }

  function resend() {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await resendVerificationAction(email);
      if (r.ok) {
        setNote("If that address is waiting to be confirmed, a new code is on its way.");
        setWait(30);
      } else setError(r.error);
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center animate-in fade-in zoom-in-95 duration-500">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <CheckCircle2 className="size-8 animate-in zoom-in-50 duration-700" />
        </span>
        <p className="text-base font-semibold">Email confirmed</p>
        {entering === "going-in" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Taking you to your company...
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {entering === "manual" ? "Your account is ready. We could not sign you in automatically: use the email and password you signed up with." : "Your account is ready. Sign in with your email and password."}
            </p>
            <Button className="mt-1 w-full" render={<Link href="/login" />} nativeButton={false}>
              Continue to sign in
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="grid gap-3 text-left" noValidate>
      <label htmlFor="ec-code" className="text-sm font-medium">
        Enter the 6-digit code
      </label>
      <CodeInput id="ec-code" value={code} onChange={setCode} disabled={pending} autoFocus invalid={Boolean(error)} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {note && <p className="text-sm text-emerald-700">{note}</p>}
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Confirm my email
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={pending || wait > 0}>
        {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
      </Button>
    </form>
  );
}
