"use client";

import { useState, useTransition } from "react";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOwnCompanyAction } from "./actions";
import { NativeSelect } from "@/components/ui/native-select";

/** Start a company of your own with the same sign-in (for example you work for someone else's company today). */
export function NewCompanyPanel({ countries, trialDays, mine }: { countries: { code: string; label: string }[]; trialDays: number; mine: number }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("IN");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createOwnCompanyAction({ companyName: name, country });
      if (r.ok) {
        toast.success(`${r.name} created. Switching to it.`);
        window.location.assign("/dashboard");
      } else setError({ message: r.error, field: r.field });
    });
  }

  return (
    <Card id="new-company">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" aria-hidden /> Start a company of your own
        </CardTitle>
        <CardDescription>
          Use the same sign-in to run another company. It gets its own {trialDays}-day free trial, its own people and its own data, and you are its administrator. Other companies you belong to cannot see it, and it cannot see them. You switch between them from the company menu at the top.
          {mine > 0 && ` You run ${mine} compan${mine === 1 ? "y" : "ies"} already.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:max-w-md" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="nc-name">Company name</Label>
            <Input id="nc-name" value={name} maxLength={80} autoComplete="organization" onChange={(e) => setName(e.target.value)} required />
            {error?.field === "companyName" && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-country">Country</Label>
            <NativeSelect id="nc-country" value={country} onChange={(e) => setCountry(e.target.value)} className="border border-input bg-background px-3">
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Sets the currency and time zone.</p>
          </div>
          {error && error.field !== "companyName" && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending || name.trim().length < 2}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Create company and switch to it
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
