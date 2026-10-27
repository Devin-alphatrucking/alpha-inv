"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/code-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction, resetPasswordCodeAction } from "./actions";

/** Password reset with the 6-digit code from the email: the code and the new password on one screen. */
export function ResetCodeForm({ email }: { email: string }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [wait, setWait] = useState(30);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== again) return setError({ message: "The two passwords do not match.", field: "password" });
    start(async () => {
      const r = await resetPasswordCodeAction({ email, code, password });
      if (r.ok) setDone(true);
      else {
        setError({ message: r.error, field: r.field });
        if (r.field === "code") setCode("");
      }
    });
  }

  function resend() {
    setError(null);
    start(async () => {
      const r = await requestResetAction(email);
      if (r.ok) {
        setNote("If that address has an account, a new code is on its way.");
        setWait(30);
      } else setError({ message: r.error });
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="text-base font-semibold">Password changed</p>
        <p className="text-sm text-muted-foreground">You were signed out on every device. Sign in with your new password.</p>
        <Button className="mt-1 w-full" render={<Link href="/login" />} nativeButton={false}>
          Continue to sign in
        </Button>
      </div>
    );
  }

  const fieldError = (f: string) => (error?.field === f ? <p role="alert" className="text-xs text-destructive">{error.message}</p> : null);

  return (
    <form onSubmit={submit} className="grid gap-4 text-left" noValidate>
      <p className="text-center text-sm text-muted-foreground">
        If <span className="font-medium text-foreground">{email}</span> has an account, we emailed it a 6-digit code (it works for 10 minutes).
      </p>
      <div className="grid gap-2">
        <Label htmlFor="rc-code">Code from the email</Label>
        <CodeInput id="rc-code" value={code} onChange={setCode} disabled={pending} autoFocus invalid={error?.field === "code"} />
        {fieldError("code")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="rc-new">New password</Label>
        <Input id="rc-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        {fieldError("password")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="rc-again">Repeat the password</Label>
        <Input id="rc-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </div>
      {error && !error.field && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      {note && <p className="text-sm text-emerald-700">{note}</p>}
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6 || !password}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Change password
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={pending || wait > 0}>
        {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
      </Button>
    </form>
  );
}
