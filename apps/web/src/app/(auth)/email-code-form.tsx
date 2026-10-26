"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/code-input";
import { confirmEmailCodeAction, resendVerificationAction } from "./actions";

/** "Enter the 6-digit code we emailed you" to confirm an address (after sign-up, or from the confirm page). */
export function EmailCodeForm({ email }: { email: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
      if (r.ok) setDone(true);
      else {
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
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="text-base font-semibold">Email confirmed</p>
        <p className="text-sm text-muted-foreground">Your account is ready. You can sign in now.</p>
        <Button className="mt-1 w-full" render={<Link href="/login" />} nativeButton={false}>
          Continue to sign in
        </Button>
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
      <Button type="submit" className="h-11 w-full" disabled={pending || code.length !== 6}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Confirm my email
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={pending || wait > 0}>
        {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
      </Button>
    </form>
  );
}
