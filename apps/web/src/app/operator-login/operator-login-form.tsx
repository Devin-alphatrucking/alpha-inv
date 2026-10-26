"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeCallbackPath } from "@/lib/security/redirect";

export function OperatorLoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password || !code.trim()) {
      setError("Enter your email, password and authenticator code.");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn("operator", { email: email.trim(), password, code: code.trim(), redirect: false });
      if (result?.error) {
        // One answer for every kind of failure: nothing here says which part was wrong or whether the address is an operator's.
        setError((result as { code?: string }).code === "rate_limited" ? "Too many attempts. Wait a few minutes and try again." : "Those details were not accepted.");
        setCode("");
        return;
      }
      const target = safeCallbackPath(params.get("callbackUrl"));
      window.location.assign(target === "/" ? "/master" : target);
    } catch {
      setError("Sign-in did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6">
      <div className="grid gap-2">
        <Label htmlFor="op-email">Email</Label>
        <Input id="op-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-base md:h-10 md:text-sm" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="op-password">Password</Label>
        <Input id="op-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 text-base md:h-10 md:text-sm" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="op-code">Authenticator code</Label>
        <Input id="op-code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code or a recovery code" value={code} onChange={(e) => setCode(e.target.value)} className="h-11 text-base md:h-10 md:text-sm" required />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-11 md:h-10" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Sign in
      </Button>
    </form>
  );
}
