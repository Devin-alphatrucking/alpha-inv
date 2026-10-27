"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== again) {
      setError("The two passwords do not match.");
      return;
    }
    start(async () => {
      const r = await resetPasswordAction({ token, password });
      if (r.ok) setDone(true);
      else setError(r.error);
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

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="rp-new">New password</Label>
        <Input id="rp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="rp-again">Repeat the password</Label>
        <Input id="rp-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Change password
      </Button>
    </form>
  );
}
