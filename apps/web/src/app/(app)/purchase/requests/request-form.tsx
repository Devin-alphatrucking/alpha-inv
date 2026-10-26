"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveRequestAction } from "../actions";
import { blankLine, LineEditor, type EditorLine } from "../line-editor";

/** Ask for materials for a project. Save it as a draft, or send it straight to a manager for approval. */
export function RequestForm({
  projectId, requestId = null, initial,
}: {
  projectId: string; requestId?: string | null; initial?: { neededBy: string; note: string; lines: EditorLine[] };
}) {
  const router = useRouter();
  const [neededBy, setNeededBy] = useState(initial?.neededBy ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial?.lines ?? [blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(thenSubmit: boolean) {
    setError(null);
    start(async () => {
      const r = await saveRequestAction(projectId, requestId, { neededBy, note, lines: lines.map(({ description, unit, quantity, materialId }) => ({ description, unit, quantity, materialId })) }, thenSubmit);
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(thenSubmit ? `${r.number} sent for approval` : `${r.number} saved as a draft`);
      router.push(`/purchase/requests/${r.id}`);
      router.refresh();
    });
  }

  return (
    <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="needed-by">Needed by</Label>
          <Input id="needed-by" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} disabled={pending} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>What do you need?</Label>
        <LineEditor lines={lines} onChange={setLines} withRates={false} disabled={pending} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="req-note">Note for the approver (optional)</Label>
        <Textarea id="req-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="Where it will be used, brand or grade, anything the purchase officer should know." />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save draft
        </Button>
        <Button type="button" disabled={pending} onClick={() => save(true)}>
          <Send className="size-4" aria-hidden /> Send for approval
        </Button>
      </div>
    </form>
  );
}
