"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { REASON_TEXT, type DuplicateGroup } from "@/lib/vendors/duplicates";
import { mergeVendorsAction } from "./actions";

/** One set of suppliers that look like the same company: choose which to keep, and fold the others into it. */
export function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(group.keepId);
  const [pending, startTransition] = useTransition();
  const keep = group.vendors.find((v) => v.id === keepId)!;
  const others = group.vendors.filter((v) => v.id !== keepId);
  const moving = others.reduce((s, v) => s + v.invoices, 0);

  function merge() {
    if (!window.confirm(`Merge ${others.map((v) => `"${v.name}"`).join(" and ")} into "${keep.name}"? Their ${moving} invoice${moving === 1 ? "" : "s"} move to "${keep.name}" and the other supplier${others.length === 1 ? "" : "s"} will be removed. This cannot be undone.`)) return;
    startTransition(async () => {
      let movedTotal = 0;
      for (const other of others) {
        const r = await mergeVendorsAction(other.id, keep.id);
        if (!r.ok) {
          toast.error(`${other.name}: ${r.error}`);
          router.refresh();
          return;
        }
        movedTotal += r.moved;
      }
      toast.success(`Merged into ${keep.name}. ${movedTotal} invoice${movedTotal === 1 ? "" : "s"} moved.`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{group.reasons.map((r) => REASON_TEXT[r]).join(" · ")}</p>
      <fieldset className="mt-2 grid gap-1.5" disabled={pending}>
        <legend className="sr-only">Which supplier to keep</legend>
        {group.vendors.map((v) => (
          <label key={v.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
            <input type="radio" name={`keep-${group.keepId}`} checked={keepId === v.id} onChange={() => setKeepId(v.id)} className="size-4" />
            <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {v.gstin ?? "no GSTIN"} · {v.invoices} invoice{v.invoices === 1 ? "" : "s"}
            </span>
            {keepId === v.id && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">keep</span>}
          </label>
        ))}
      </fieldset>
      <Button type="button" size="sm" className="mt-3" onClick={merge} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GitMerge className="size-4" aria-hidden />}
        Merge into {keep.name}
      </Button>
    </div>
  );
}

/** On one supplier's page: fold this supplier into another one chosen from a list. */
export function MergeIntoControl({ fromId, fromName, invoices, candidates }: { fromId: string; fromName: string; invoices: number; candidates: { id: string; name: string; gstin: string | null }[] }) {
  const router = useRouter();
  const [intoId, setIntoId] = useState("");
  const [pending, startTransition] = useTransition();
  const target = candidates.find((c) => c.id === intoId);

  function merge() {
    if (!target) return;
    if (!window.confirm(`Merge "${fromName}" into "${target.name}"? Its ${invoices} invoice${invoices === 1 ? "" : "s"} move to "${target.name}" and "${fromName}" will be removed. This cannot be undone.`)) return;
    startTransition(async () => {
      const r = await mergeVendorsAction(fromId, target.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Merged into ${r.keptName}. ${r.moved} invoice${r.moved === 1 ? "" : "s"} moved.`);
      router.push(`/vendors/${target.id}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-64 flex-1 gap-1.5 text-xs text-muted-foreground">
        Merge this supplier into
        <select value={intoId} onChange={(e) => setIntoId(e.target.value)} disabled={pending} className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground">
          <option value="">Choose the supplier to keep…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.gstin ? ` (${c.gstin})` : ""}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" variant="outline" onClick={merge} disabled={!target || pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GitMerge className="size-4" aria-hidden />}
        Merge
      </Button>
    </div>
  );
}
