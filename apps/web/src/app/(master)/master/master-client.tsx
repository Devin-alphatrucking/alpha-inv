"use client";

import Link from "next/link";
import { useConfirm } from "@/components/confirm-provider";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { reconcileAction, resetTwoStepAction, setTicketStatusAction, type MasterResult } from "./actions";
import { NativeSelect } from "@/components/ui/native-select";

const NAV = [
  { href: "/master", label: "Overview", exact: true },
  { href: "/master/companies", label: "Companies" },
  { href: "/master/follow-ups", label: "Follow-ups" },
  { href: "/master/billing", label: "Billing" },
  { href: "/master/plans", label: "Plans" },
  { href: "/master/tickets", label: "Tickets" },
  { href: "/master/logs", label: "Logs" },
];

export function MasterNav() {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Master console">
      {NAV.map((item) => {
        const active = item.exact ? path === item.href : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export type Field = {
  name: string;
  label: string;
  type?: "number" | "text" | "email" | "select" | "checkbox";
  defaultValue?: string | number | null;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  required?: boolean;
  /** For a select: the choices. */
  options?: { value: string; label: string }[];
};

/**
 * One small form for every master change: some fields, a REQUIRED reason, one button. Shows the result right under the button.
 * `confirmText` asks "are you sure" first (for changes that affect people's access or everyone on a plan).
 */
export function ActionForm({
  action,
  fields,
  submit,
  confirmText,
  destructive,
  reasonLabel = "Reason (kept in the audit log)",
}: {
  action: (values: Record<string, string>) => Promise<MasterResult>;
  fields: Field[];
  submit: string;
  confirmText?: string;
  destructive?: boolean;
  reasonLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MasterResult | null>(null);
  const ask = useConfirm();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (confirmText && !(await ask({ title: "Are you sure?", description: confirmText, confirmLabel: submit, variant: destructive ? "destructive" : "default" }))) return;
    setResult(null);
    start(async () => {
      const r = await action(data);
      setResult(r);
      if (r.ok) {
        form.reset();
        if (r.href) router.push(r.href);
        else router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <label key={f.name} htmlFor={`f-${f.name}`} className="flex items-start gap-2 text-sm sm:col-span-2">
              <input id={`f-${f.name}`} name={f.name} type="checkbox" required={f.required} className="mt-1 size-4" />
              <span>
                {f.label}
                {f.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{f.hint}</span>}
              </span>
            </label>
          ) : (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={`f-${f.name}`} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              {f.type === "select" ? (
                <NativeSelect id={`f-${f.name}`} name={f.name} required={f.required} defaultValue={f.defaultValue ?? ""}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input id={`f-${f.name}`} name={f.name} type={f.type ?? "text"} inputMode={f.type === "number" ? "numeric" : undefined} min={f.min} max={f.max} required={f.required} defaultValue={f.defaultValue ?? ""} placeholder={f.placeholder} />
              )}
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ),
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="f-reason" className="text-xs text-muted-foreground">
          {reasonLabel}
        </Label>
        <Input id="f-reason" name="reason" required minLength={3} maxLength={300} placeholder="For example: partner deal agreed by email" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant={destructive ? "destructive" : "default"} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
          {submit}
        </Button>
        {result && (
          <p role="status" className={cn("text-sm", result.ok ? "text-emerald-600" : "text-red-600")}>
            {result.ok ? result.message : result.error}
          </p>
        )}
      </div>
    </form>
  );
}

export function TicketStatusButtons({ ticketId, current }: { ticketId: string; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["OPEN", "WAITING", "RESOLVED"] as const).map((s) => (
        <Button
          key={s}
          size="sm"
          variant={s === current ? "default" : "outline"}
          disabled={pending || s === current}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await setTicketStatusAction(ticketId, s);
              if (!r.ok) setError(r.error);
              router.refresh();
            })
          }
        >
          {s === "OPEN" ? "Open" : s === "WAITING" ? "Waiting on customer" : "Resolved"}
        </Button>
      ))}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

export function ReconcileButton({ orgId, label = "Re-check with Razorpay" }: { orgId?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MasterResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            const r = await reconcileAction(orgId);
            setResult(r);
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
        {label}
      </Button>
      {result && <span role="status" className={cn("text-sm", result.ok ? "text-emerald-600" : "text-red-600")}>{result.ok ? result.message : result.error}</span>}
    </div>
  );
}

/**
 * "Reset two-step" beside a person who has it on. Opens a small form: confirm you checked who they are, write the reason, go.
 * The person is signed out everywhere and emailed; the reset is logged against the company.
 */
export function ResetTwoStepControl({ orgId, userId, name }: { orgId: string; userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const action = resetTwoStepAction.bind(null, orgId, userId);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Reset two-step sign-in for ${name}`}>
        Reset two-step
      </Button>
    );
  }
  return (
    <div className="mt-2 w-full rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Turns off two-step sign-in for {name}, signs them out everywhere and emails them. They can turn it on again from their Account page.
      </p>
      <ActionForm
        action={action}
        submit="Turn off two-step"
        destructive
        confirmText={`Turn off two-step sign-in for ${name}?`}
        reasonLabel="Reason and how you checked who they are (kept in the audit log)"
        fields={[{ name: "identity", label: "I have checked that this really is " + name + " (not someone pretending).", type: "checkbox", required: true }]}
      />
      <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
