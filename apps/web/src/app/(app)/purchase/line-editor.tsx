"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormat } from "@/components/format-provider";
import { lineAmount, parseGst, parseMoney, parseQuantity } from "@/lib/purchase/rules";

export type EditorLine = { description: string; unit: string; quantity: string; rate: string; gstPercent: string; materialId?: string | null };
export const blankLine = (): EditorLine => ({ description: "", unit: "", quantity: "", rate: "", gstPercent: "18", materialId: null });

const UNITS = ["NOS", "BAG", "KG", "TON", "MTR", "SQM", "CUM", "LTR", "BOX", "SET"];

/** The items of a request or order. With `withRates` each line also has a rate and GST, and the amounts add up as you type. */
export function LineEditor({ lines, onChange, withRates, disabled }: { lines: EditorLine[]; onChange: (lines: EditorLine[]) => void; withRates: boolean; disabled?: boolean }) {
  const fmt = useFormat();
  const formatMoney = (minor: number) => fmt.money(minor / 100, 2);
  const set = (i: number, k: keyof EditorLine, v: string) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const amount = (l: EditorLine) => {
    const q = parseQuantity(l.quantity);
    const r = parseMoney(l.rate);
    const g = parseGst(l.gstPercent);
    return q !== null && r !== null && g !== null ? lineAmount(q, r, g) : null;
  };
  const total = lines.reduce((s, l) => s + (amount(l)?.totalMinor ?? 0), 0);

  return (
    <div className="grid gap-3">
      <datalist id="unit-choices">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      {lines.map((l, i) => {
        const a = withRates ? amount(l) : null;
        return (
          <div key={i} className="grid gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <Input value={l.description} onChange={(e) => set(i, "description", e.target.value)} placeholder={`Item ${i + 1} (e.g. Cement OPC 53)`} aria-label={`Item ${i + 1}`} maxLength={220} disabled={disabled} />
              <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <div className={`grid gap-2 ${withRates ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
              <Input value={l.quantity} inputMode="decimal" onChange={(e) => set(i, "quantity", e.target.value)} placeholder="Quantity" aria-label={`Quantity for item ${i + 1}`} disabled={disabled} />
              <Input value={l.unit} list="unit-choices" onChange={(e) => set(i, "unit", e.target.value)} placeholder="Unit" aria-label={`Unit for item ${i + 1}`} maxLength={12} disabled={disabled} />
              {withRates && (
                <>
                  <Input value={l.rate} inputMode="decimal" onChange={(e) => set(i, "rate", e.target.value)} placeholder="Rate" aria-label={`Rate for item ${i + 1}`} disabled={disabled} />
                  <Input value={l.gstPercent} inputMode="decimal" onChange={(e) => set(i, "gstPercent", e.target.value)} placeholder="GST %" aria-label={`GST percent for item ${i + 1}`} disabled={disabled} />
                </>
              )}
            </div>
            {a && <p className="text-right text-xs text-muted-foreground tabular-nums">{formatMoney(a.amountMinor)} + GST {formatMoney(a.gstMinor)} = <span className="font-medium text-foreground">{formatMoney(a.totalMinor)}</span></p>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" disabled={disabled || lines.length >= 60} onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="size-4" aria-hidden /> Add an item
        </Button>
        {withRates && <p className="text-sm tabular-nums">Total with GST: <span className="text-base font-semibold">{formatMoney(total)}</span></p>}
      </div>
    </div>
  );
}
