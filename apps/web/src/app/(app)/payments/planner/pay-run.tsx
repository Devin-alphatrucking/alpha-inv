"use client";

import { useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormat } from "@/components/format-provider";
import { cn } from "@/lib/utils";
import { PAYMENT_MODES, parsePayAmount, presetIds, type Preset } from "@/lib/invoices/planner";
import type { Owed } from "@/lib/invoices/ageing";
import { recordPayRunAction } from "./actions";
import { StepUpDialog } from "@/components/step-up-dialog";
import type { PayRunResult } from "@/lib/flows/pay-run";
import { NativeSelect } from "@/components/ui/native-select";

export type PlannerRow = Pick<Owed, "id" | "invoiceNumber" | "vendorName" | "projectName" | "balanceMinor" | "daysLate"> & { dueLabel: string };

const PRESETS: { key: Preset; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due within 7 days" },
  { key: "fortnight", label: "Due within 14 days" },
  { key: "all", label: "Everything" },
  { key: "none", label: "Clear" },
];

const lateText = (d: number | null) => (d === null ? "No due date" : d > 0 ? `${d} day${d === 1 ? "" : "s"} late` : d === 0 ? "Due today" : `Due in ${-d} day${d === -1 ? "" : "s"}`);

/** Pick the bills to pay, adjust any amount (a part payment), and record them all at once. */
export function PayRun({ rows, today }: { rows: PlannerRow[]; today: string }) {
  const fmt = useFormat();
  const router = useRouter();
  const ask = useConfirm();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Record<string, string>>({}); // invoice id -> the amount as typed
  const [filter, setFilter] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<PayRunResult | null>(null);
  const [needCode, setNeedCode] = useState(false);

  const money = (minor: number) => fmt.money(minor / 100, 2);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.vendorName.toLowerCase().includes(q) || r.invoiceNumber.toLowerCase().includes(q) || r.projectName.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const full = (id: string) => String((byId.get(id)!.balanceMinor / 100).toFixed(2)).replace(/\.00$/, "");
  const checks = Object.entries(picked).map(([id, text]) => ({ id, parsed: parsePayAmount(text, byId.get(id)?.balanceMinor ?? 0) }));
  const valid = checks.length > 0 && checks.every((c) => c.parsed.ok);
  const total = checks.reduce((s, c) => s + (c.parsed.ok ? c.parsed.minor : 0), 0);

  function applyPreset(p: Preset) {
    setResult(null);
    setPicked(Object.fromEntries(presetIds(rows, p).map((id) => [id, full(id)])));
  }
  function toggle(id: string, on: boolean) {
    setResult(null);
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[id] = full(id);
      else delete next[id];
      return next;
    });
  }

  const payload = () => ({ items: checks.map((c) => ({ invoiceId: c.id, amount: c.parsed.ok ? c.parsed.minor / 100 : 0 })), paidOn, mode, reference });

  /** Shows what a finished run did and keeps only the bills that failed ticked. */
  function showResult(r: PayRunResult) {
    setResult(r);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast[r.failed === 0 ? "success" : "warning"](r.failed === 0 ? `${r.paid} payment${r.paid === 1 ? "" : "s"} recorded` : `${r.paid} recorded, ${r.failed} could not be`);
    setPicked((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => r.lines.some((l) => l.invoiceId === id && !l.ok))));
    router.refresh();
  }

  async function submit() {
    if (!valid || pending) return;
    if (!(await ask({ title: "Record these payments?", description: `Record ${checks.length} payment${checks.length === 1 ? "" : "s"} totalling ${money(total)}, paid on ${paidOn} by ${mode}?`, confirmLabel: "Record payments", variant: "default" }))) return;
    startTransition(async () => {
      const r = await recordPayRunAction(payload());
      // Money going out: the first time in 15 minutes, a code from email confirms it is you.
      if (!r.ok && "needsCode" in r && r.needsCode) {
        setNeedCode(true);
        return;
      }
      showResult(r);
    });
  }

  async function submitWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await recordPayRunAction(payload(), code);
    if (!r.ok && "needsCode" in r && r.needsCode) return { ok: false, error: r.error };
    showResult(r);
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Tick:</span>
        {PRESETS.map((p) => (
          <Button key={p.key} type="button" size="sm" variant="outline" onClick={() => applyPreset(p.key)} disabled={pending}>
            {p.label}
          </Button>
        ))}
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a supplier or invoice" className="ml-auto w-full max-w-56" aria-label="Find a supplier or invoice" />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Nothing is owed right now. Every confirmed invoice is paid.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Bills still owed">
          {shown.map((r) => {
            const on = r.id in picked;
            const check = on ? parsePayAmount(picked[r.id], r.balanceMinor) : null;
            return (
              <li key={r.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-3.5 py-3", on && "border-primary/50 bg-primary/5")}>
                <label className="flex min-w-0 flex-1 basis-60 cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(r.id, e.target.checked)} disabled={pending} className="mt-1 size-4" aria-label={`Pay ${r.vendorName} ${r.invoiceNumber}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.vendorName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <Link href={`/invoices/${r.id}`} className="underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.invoiceNumber}
                      </Link>{" "}
                      · {r.projectName}
                    </span>
                  </span>
                </label>
                <span className={cn("text-xs", r.daysLate !== null && r.daysLate > 0 ? "font-medium text-red-600" : "text-muted-foreground")}>
                  {lateText(r.daysLate)}{r.daysLate === null ? "" : ` · ${r.dueLabel}`}
                </span>
                <span className="w-28 text-right text-sm font-semibold tabular-nums">{money(r.balanceMinor)}</span>
                {on && (
                  <span className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    <label htmlFor={`amt-${r.id}`} className="text-xs text-muted-foreground">
                      Paying
                    </label>
                    <Input
                      id={`amt-${r.id}`}
                      value={picked[r.id]}
                      onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      inputMode="decimal"
                      className={cn("h-8 w-32 text-right tabular-nums", check && !check.ok && "border-destructive")}
                      aria-invalid={check ? !check.ok : undefined}
                      aria-describedby={check && !check.ok ? `err-${r.id}` : undefined}
                    />
                    {check && !check.ok && (
                      <span id={`err-${r.id}`} role="alert" className="text-xs text-destructive">
                        {check.error}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No bill matches that search.</li>}
        </ul>
      )}

      {result?.ok && (
        <div className="rounded-xl border bg-card p-4" role="status">
          <p className="text-sm font-medium">
            {result.paid} of {result.lines.length} recorded, {money(result.totalMinor)} paid.
          </p>
          <ul className="mt-2 grid gap-1 text-sm">
            {result.lines.map((l) => (
              <li key={l.invoiceId} className="flex items-start gap-2">
                {l.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                <span>
                  <span className="font-medium">{l.invoiceNumber}</span>{" "}
                  <span className={l.ok ? "text-muted-foreground" : "text-destructive"}>{l.ok ? (l.status === "PAID" ? "paid in full" : "part paid") : l.error}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-3 z-10 rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur max-md:bottom-24">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-xs text-muted-foreground">{checks.length} selected</p>
            <p className="text-xl font-semibold tabular-nums">{money(total)}</p>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Paid on
            <Input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className="w-auto" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Mode
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)} className="border border-input bg-background text-foreground">
              {PAYMENT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Reference (optional)
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder="Batch or bank reference" className="w-44" />
          </label>
          <Button type="button" onClick={submit} disabled={!valid || pending || !paidOn}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Record {checks.length || ""} payment{checks.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
      <StepUpDialog open={needCode} onOpenChange={setNeedCode} action="Record a payment run" onConfirm={submitWithCode} />
    </div>
  );
}
