"use client";

import { EmailCodeForm } from "../email-code-form";
import { useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "../actions";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  countries: { code: string; label: string }[];
  termsUrl: string | null;
  privacyUrl: string | null;
};

export function SignUpForm({ countries, termsUrl, privacyUrl }: Props) {
  const [v, setV] = useState({ companyName: "", name: "", email: "", phone: "", password: "", country: "IN", acceptTerms: false });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await signUpAction(v);
      if (r.ok) setSentTo(v.email);
      else setError({ message: r.error, field: r.field });
    });
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <MailCheck className="size-10 text-emerald-600" />
        <p className="text-base font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{sentTo}</span> can be used for a new account, we have emailed it a 6-digit code. Enter it below (it works for 10 minutes), or use the link in the same email.
        </p>
        <div className="w-full pt-1">
          <EmailCodeForm email={sentTo} />
        </div>
        <p className="text-xs text-muted-foreground">Nothing arrived? Look in your spam folder.</p>
      </div>
    );
  }

  const fieldError = (name: string) => (error?.field === name ? <p className="text-xs text-destructive">{error.message}</p> : null);

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="su-company">Company name</Label>
        <Input id="su-company" value={v.companyName} maxLength={80} autoComplete="organization" onChange={(e) => set("companyName", e.target.value)} required />
        {fieldError("companyName")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="su-name">Your name</Label>
        <Input id="su-name" value={v.name} maxLength={80} autoComplete="name" onChange={(e) => set("name", e.target.value)} required />
        {fieldError("name")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="su-email">Work email</Label>
        <Input id="su-email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={(e) => set("email", e.target.value)} required />
        {fieldError("email")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="su-phone">Mobile number</Label>
        <Input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={v.phone} onChange={(e) => set("phone", e.target.value)} required />
        <p className="text-xs text-muted-foreground">So your team and our support can reach you. Add the country code (+61...) if it is not from the country below.</p>
        {fieldError("phone")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="su-password">Password</Label>
        <Input id="su-password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => set("password", e.target.value)} required />
        <p className="text-xs text-muted-foreground">At least 10 characters. A few random words make a strong password.</p>
        {fieldError("password")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="su-country">Country</Label>
        <NativeSelect
          id="su-country"
          value={v.country}
          onChange={(e) => set("country", e.target.value)}
          className="border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">Sets your currency and timezone. You can change them later.</p>
        {fieldError("country")}
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={v.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} className="mt-1 size-4" />
        <span>
          I agree to the{" "}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              terms of service
            </a>
          ) : (
            "terms of service"
          )}{" "}
          and{" "}
          {privacyUrl ? (
            <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              privacy policy
            </a>
          ) : (
            "privacy policy"
          )}
          .
        </span>
      </label>
      {fieldError("acceptTerms")}
      {error && !error.field && <p className="text-sm text-destructive">{error.message}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Create account
      </Button>
    </form>
  );
}
