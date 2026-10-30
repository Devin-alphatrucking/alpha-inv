"use client";

import { EmailCodeForm } from "../email-code-form";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "../actions";
import { NativeSelect } from "@/components/ui/native-select";
import { PHONE_EXAMPLE, phoneHint } from "@/lib/security/phone";

type Props = {
  countries: { code: string; label: string }[];
  termsUrl: string | null;
  privacyUrl: string | null;
};

/**
 * One field: label, input, then a line of help (or the error). Inside a two-column row every field shares the same three rows
 * (subgrid), so the inputs line up whatever the length of the help text.
 */
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error: string | null; children: React.ReactNode }) {
  return (
    <div className="row-span-3 grid grid-rows-subgrid gap-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">{hint ?? "\u00a0"}</p>}
    </div>
  );
}

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
          We have emailed a 6-digit code to <span className="font-medium text-foreground">{sentTo}</span>. Enter it below (it works for 10 minutes), or use the link in the same email.
        </p>
        <div className="w-full pt-1">
          <EmailCodeForm email={sentTo} password={v.password} />
        </div>
        <p className="text-xs text-muted-foreground">
          Nothing arrived? Look in your spam folder. If this address already has an account, the email tells you how to sign in instead.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <button type="button" onClick={() => setSentTo(null)} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Use a different email
          </button>
          <Link href="/login" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Already confirmed? Sign in
          </Link>
        </div>
      </div>
    );
  }

  const err = (name: string) => (error?.field === name ? error.message : null);

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <fieldset className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your company</legend>
        <Field id="su-company" label="Company name" error={err("companyName")} hint="As it should appear on your invoices.">
          <Input id="su-company" value={v.companyName} maxLength={80} autoComplete="organization" onChange={(e) => set("companyName", e.target.value)} required />
        </Field>
        <Field id="su-country" label="Country" error={err("country")} hint="Sets your currency and timezone. You can change them later.">
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
        </Field>
      </fieldset>

      <fieldset className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">About you</legend>
        <Field id="su-name" label="Your name" error={err("name")} hint="You will be the company's administrator.">
          <Input id="su-name" value={v.name} maxLength={80} autoComplete="name" onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field id="su-phone" label="Mobile number" error={err("phone")} hint={phoneHint(v.country)}>
          <Input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={PHONE_EXAMPLE[v.country] ?? PHONE_EXAMPLE.IN} value={v.phone} onChange={(e) => set("phone", e.target.value)} required />
        </Field>
        <Field id="su-email" label="Work email" error={err("email")} hint="We email a code here to confirm it.">
          <Input id="su-email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={(e) => set("email", e.target.value)} required />
        </Field>
        <Field id="su-password" label="Password" error={err("password")} hint="At least 10 characters. A few random words make a strong password.">
          <Input id="su-password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => set("password", e.target.value)} required />
        </Field>
      </fieldset>
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
      {error?.field === "acceptTerms" && <p className="text-xs text-destructive">{error.message}</p>}
      {error && !error.field && <p className="text-sm text-destructive">{error.message}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Create account
      </Button>
    </form>
  );
}
