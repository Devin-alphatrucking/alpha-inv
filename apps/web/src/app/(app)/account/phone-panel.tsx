"use client";

import { useState, useTransition } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/security/phone";
import { updatePhoneAction } from "./phone-actions";

/** Your mobile number: shown to the administrators of your companies and to our support. People who signed up with Google add it here. */
export function PhonePanel({ initial }: { initial: string | null }) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await updatePhoneAction(value);
      if (r.ok) {
        setSaved(r.phone);
        setValue("");
        toast.success("Mobile number saved");
      } else setError(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" aria-hidden /> Mobile number
        </CardTitle>
        <CardDescription>{saved ? <>Saved: <span className="font-medium text-foreground">{formatPhone(saved)}</span></> : "No number saved yet."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:max-w-sm" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="acc-phone">{saved ? "Change number" : "Add your number"}</Label>
            <Input id="acc-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="text-xs text-muted-foreground">Add the country code (+61...) if it is not from your company&apos;s country.</p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <Button type="submit" size="sm" className="w-fit" disabled={pending || value.trim() === ""}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Save number
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
