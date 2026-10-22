"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInviteAction } from "../actions";

type Props = {
  token: string;
  invite: { email: string; company: string; slug: string; hasAccount: boolean };
  signedInAsInvitee: boolean;
  signedInOther: boolean;
  termsUrl: string | null;
  privacyUrl: string | null;
};

export function AcceptInviteForm({ token, invite, signedInAsInvitee, signedInOther, termsUrl, privacyUrl }: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [joined, setJoined] = useState(false);
  const [pending, start] = useTransition();

  function accept(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    start(async () => {
      const r = await acceptInviteAction({ token, name, password, acceptTerms });
      if (r.ok) setJoined(true);
      else setError({ message: r.error, field: r.field });
    });
  }

  if (joined) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="text-base font-semibold">You joined {invite.company}</p>
        <p className="text-sm text-muted-foreground">Sign in to start.</p>
        <Button className="mt-1 w-full" render={<Link href={`/login?c=${invite.slug}`} />} nativeButton={false}>
          Continue to sign in
        </Button>
      </div>
    );
  }

  // Already has an account
  if (invite.hasAccount) {
    if (signedInAsInvitee) {
      return (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">You are signed in as {invite.email}. Join {invite.company} with this account?</p>
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          <Button onClick={() => accept()} disabled={pending} className="h-11 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Join {invite.company}
          </Button>
        </div>
      );
    }
    const back = encodeURIComponent(`/accept-invite?token=${token}`);
    return (
      <div className="grid gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          {signedInOther
            ? `You are signed in as a different person. Sign in as ${invite.email} to accept.`
            : `${invite.email} already has an account. Sign in to join ${invite.company}.`}
        </p>
        {signedInOther ? (
          <Button onClick={() => signOut({ callbackUrl: `/login?callbackUrl=${back}` })} className="h-11 w-full">
            Sign out and sign in as {invite.email}
          </Button>
        ) : (
          <Button render={<Link href={`/login?callbackUrl=${back}&c=${invite.slug}`} />} nativeButton={false} className="h-11 w-full">
            Sign in to accept
          </Button>
        )}
      </div>
    );
  }

  // New person
  const fieldError = (n: string) => (error?.field === n ? <p className="text-xs text-destructive">{error.message}</p> : null);
  return (
    <form onSubmit={accept} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="ai-email">Email</Label>
        <Input id="ai-email" value={invite.email} readOnly disabled />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ai-name">Your name</Label>
        <Input id="ai-name" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} required />
        {fieldError("name")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ai-password">Choose a password</Label>
        <Input id="ai-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        {fieldError("password")}
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 size-4" />
        <span>
          I agree to the{" "}
          {termsUrl ? <a href={termsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">terms of service</a> : "terms of service"} and{" "}
          {privacyUrl ? <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">privacy policy</a> : "privacy policy"}.
        </span>
      </label>
      {fieldError("acceptTerms")}
      {error && !error.field && <p className="text-sm text-destructive">{error.message}</p>}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Create my account and join
      </Button>
    </form>
  );
}
