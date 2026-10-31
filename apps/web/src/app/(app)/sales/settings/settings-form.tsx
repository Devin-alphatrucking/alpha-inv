"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GST_STATE_LIST } from "@/lib/gst/gstin";
import { saveProfileAction } from "../actions";

type Profile = { legalName: string; gstin: string | null; stateCode: string; address: string; phone: string | null; email: string | null; bankDetails: string | null; terms: string | null; prefix: string };

export function SettingsForm({ initial, canEdit }: { initial: Profile | null; canEdit: boolean }) {
  const [v, setV] = useState({
    legalName: initial?.legalName ?? "",
    gstin: initial?.gstin ?? "",
    stateCode: initial?.stateCode ?? "",
    address: initial?.address ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    bankDetails: initial?.bankDetails ?? "",
    terms: initial?.terms ?? "",
    prefix: initial?.prefix ?? "INV",
  });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, value: string) => setV((p) => ({ ...p, [k]: value }));
  const err = (f: string) => (error?.field === f ? error.message : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        const r = await saveProfileAction(v);
        if (r.ok) toast.success("Company details saved");
        else setError({ message: r.error, field: r.field });
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  const field = (id: keyof typeof v, label: string, input: React.ReactNode, hint?: string) => (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`sp-${id}`}>{label}</Label>
      {input}
      {err(id) ? <p className="text-xs text-destructive">{err(id)}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {field("legalName", "Company name on invoices", <Input id="sp-legalName" value={v.legalName} maxLength={120} disabled={!canEdit} onChange={(e) => set("legalName", e.target.value)} />)}
      {field("gstin", "Your GSTIN", <Input id="sp-gstin" value={v.gstin} maxLength={20} disabled={!canEdit} className="uppercase" onChange={(e) => set("gstin", e.target.value)} />, "Leave empty if you are not registered for GST.")}
      {field(
        "stateCode",
        "State",
        <NativeSelect id="sp-stateCode" value={v.stateCode} disabled={!canEdit} className="w-full" onChange={(e) => set("stateCode", e.target.value)}>
          <option value="">Choose your state</option>
          {GST_STATE_LIST.map(([code, name]) => (
            <option key={code} value={code}>{code} - {name}</option>
          ))}
        </NativeSelect>,
        "Decides CGST + SGST or IGST.",
      )}
      {field("prefix", "Invoice number prefix", <Input id="sp-prefix" value={v.prefix} maxLength={8} disabled={!canEdit} className="uppercase" onChange={(e) => set("prefix", e.target.value)} />, "Numbers look like INV/2026-27/0001 and restart each financial year.")}
      <div className="sm:col-span-2">{field("address", "Address", <Textarea id="sp-address" value={v.address} rows={3} maxLength={300} disabled={!canEdit} onChange={(e) => set("address", e.target.value)} />)}</div>
      {field("phone", "Phone", <Input id="sp-phone" type="tel" value={v.phone} maxLength={30} disabled={!canEdit} onChange={(e) => set("phone", e.target.value)} />)}
      {field("email", "Email", <Input id="sp-email" type="email" value={v.email} maxLength={120} disabled={!canEdit} onChange={(e) => set("email", e.target.value)} />)}
      <div className="sm:col-span-2">{field("bankDetails", "Bank details (printed on the invoice)", <Textarea id="sp-bankDetails" value={v.bankDetails} rows={3} maxLength={400} disabled={!canEdit} onChange={(e) => set("bankDetails", e.target.value)} />, "Bank, account number, IFSC and UPI, if you want customers to pay you directly.")}</div>
      <div className="sm:col-span-2">{field("terms", "Terms (printed at the bottom)", <Textarea id="sp-terms" value={v.terms} rows={3} maxLength={600} disabled={!canEdit} onChange={(e) => set("terms", e.target.value)} />)}</div>
      {error && !error.field && <p className="text-sm text-destructive sm:col-span-2">{error.message}</p>}
      {canEdit && (
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save details
          </Button>
        </div>
      )}
    </form>
  );
}
