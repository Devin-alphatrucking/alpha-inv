"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmEmailAction, resendVerificationAction } from "../actions";

export function VerifyEmailPanel({ token, linkProblem }: { token: string | null; linkProblem: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(linkProblem ? "This confirmation link is invalid or has expired. Request a new one below." : null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  function confirm() {
    if (!token) return;
    setError(null);
    start(async () => {
      const r = await confirmEmailAction(token);
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  function resend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await resendVerificationAction(email);
      if (r.ok) setSent(r.message);
      else setError(r.error);
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
    <div className="grid gap-4">
      {token && (
        <Button onClick={confirm} disabled={pending} className="h-11 w-full">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Confirm my email
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!token && (
        <form onSubmit={resend} className="grid gap-3">
          <p className="text-sm text-muted-foreground">Enter your email and we will send a new confirmation link.</p>
          <div className="grid gap-2">
            <Label htmlFor="ve-email">Email</Label>
            <Input id="ve-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {sent ? (
            <p className="text-sm text-emerald-700">{sent}</p>
          ) : (
            <Button type="submit" disabled={pending} className="h-11 w-full">
              {pending && <Loader2 className="size-4 animate-spin" />}
              Send a new link
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
