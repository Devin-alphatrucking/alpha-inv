"use client";

import { ResetCodeForm } from "../reset-code-form";
import { useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction } from "../actions";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await requestResetAction(email);
      if (r.ok) setMessage(r.message);
      else setError(r.error);
    });
  }

  if (message) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <MailCheck className="size-10 text-emerald-600" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="w-full pt-1">
          <ResetCodeForm email={email.trim().toLowerCase()} />
        </div>
        <p className="text-xs text-muted-foreground">Prefer the link in the email? It works for 1 hour. Check your spam folder if nothing arrives.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="fp-email">Email</Label>
        <Input id="fp-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
