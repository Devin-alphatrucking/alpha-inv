"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { GST_STATE_LIST } from "@/lib/gst/gstin";
import { createCustomerAction } from "../actions";

const EMPTY = { name: "", gstin: "", stateCode: "", address: "", phone: "", email: "" };

/** Add a customer. With a GSTIN the state is read from it; without one, choose the state (needed to work out the tax). */
export function CustomerForm({ onCreated, embedded }: { onCreated?: (id: string) => void; embedded?: boolean }) {
  const [v, setV] = useState(EMPTY);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, value: string) => setV((p) => ({ ...p, [k]: value }));
  const err = (f: string) => (error?.field === f ? <p className="text-xs text-destructive">{error!.message}</p> : null);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    start(async () => {
      try {
        const r = await createCustomerAction(v);
        if (r.ok) {
          toast.success("Customer added");
          setV(EMPTY);
          onCreated?.(r.id);
        } else setError({ message: r.error, field: r.field });
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  // Inside another form (the invoice) a second <form> is not allowed, so it is a plain block with a button that saves.
  const Wrapper = embedded ? "div" : "form";
  return (
    <Wrapper {...(embedded ? {} : { onSubmit: submit, noValidate: true })} className="grid gap-4 sm:grid-cols-2">
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-name">Name</Label>
        <Input id="sc-name" value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
        {err("name")}
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-gstin">GSTIN (if they have one)</Label>
        <Input id="sc-gstin" value={v.gstin} maxLength={20} className="uppercase" onChange={(e) => set("gstin", e.target.value)} />
        {err("gstin")}
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-state">State</Label>
        <NativeSelect id="sc-state" value={v.stateCode} className="w-full" onChange={(e) => set("stateCode", e.target.value)}>
          <option value="">{v.gstin.trim() ? "Taken from the GSTIN" : "Choose the state"}</option>
          {GST_STATE_LIST.map(([code, name]) => (
            <option key={code} value={code}>{code} - {name}</option>
          ))}
        </NativeSelect>
        {err("stateCode")}
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-phone">Phone</Label>
        <Input id="sc-phone" type="tel" value={v.phone} maxLength={30} onChange={(e) => set("phone", e.target.value)} />
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-email">Email</Label>
        <Input id="sc-email" type="email" value={v.email} maxLength={120} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="sc-address">Address</Label>
        <Input id="sc-address" value={v.address} maxLength={300} onChange={(e) => set("address", e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Button type={embedded ? "button" : "submit"} disabled={pending} onClick={embedded ? () => submit() : undefined}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Add customer
        </Button>
      </div>
    </Wrapper>
  );
}
