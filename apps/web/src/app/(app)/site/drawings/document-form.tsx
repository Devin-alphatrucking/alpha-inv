"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_EXTENSIONS, CATEGORIES, CATEGORY_LABEL, DOCUMENT_MAX_BYTES } from "@/lib/site/document-rules";

const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 md:h-10 md:text-sm dark:bg-input/30";
const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/**
 * Add a new drawing (no `documentId`) or a new revision of one. The file goes to the server, which checks what it really is.
 * `suggestedRevision` is the usual next name (A, then B...).
 */
export function DocumentForm({ projectId, documentId, suggestedRevision, today }: { projectId?: string; documentId?: string; suggestedRevision: string; today: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({ title: "", number: "", category: "STRUCTURAL", description: "", revision: suggestedRevision, note: "", issuedOn: today });
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const bad = (f: string) => (error?.field === f ? true : undefined);
  const isNew = !documentId;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const chosen = file.current?.files?.[0];
    if (!chosen) return setError({ field: "file", message: "Choose the file to add." });
    if (chosen.size > DOCUMENT_MAX_BYTES) return setError({ field: "file", message: `A file must be ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB or smaller.` });
    setBusy(true);
    try {
      const form = new FormData();
      if (projectId) form.set("projectId", projectId);
      for (const [k, val] of Object.entries(v)) form.set(k, val);
      form.set("file", chosen);
      const res = await fetch(documentId ? `/api/site/documents/${documentId}` : "/api/site/documents", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; field?: string };
      if (!res.ok || !data.ok) {
        setError({ field: data.field, message: data.error ?? "The file could not be added." });
        return;
      }
      toast.success(isNew ? "Drawing added" : `Revision ${v.revision.toUpperCase()} added`);
      if (file.current) file.current.value = "";
      setFileName("");
      if (isNew && data.id) router.push(`/site/drawings/${data.id}`);
      else router.refresh();
    } catch {
      setError({ message: "The file could not be sent. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {isNew && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={v.title} onChange={set("title")} maxLength={160} placeholder="e.g. Foundation plan" aria-invalid={bad("title")} disabled={busy} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-number">Drawing number (optional)</Label>
            <Input id="d-number" value={v.number} onChange={set("number")} maxLength={40} placeholder="e.g. S-101" aria-invalid={bad("number")} disabled={busy} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-cat">Category</Label>
            <select id="d-cat" className={selectClass} value={v.category} onChange={set("category")} disabled={busy} aria-invalid={bad("category")}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="d-rev">Revision</Label>
          <Input id="d-rev" value={v.revision} onChange={set("revision")} maxLength={12} placeholder="A" aria-invalid={bad("revision")} disabled={busy} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="d-date">Issued on</Label>
          <Input id="d-date" type="date" value={v.issuedOn} max={today} onChange={set("issuedOn")} aria-invalid={bad("issuedOn")} disabled={busy} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="d-note">What changed (optional)</Label>
        <Textarea id="d-note" rows={2} value={v.note} onChange={set("note")} maxLength={520} aria-invalid={bad("note")} placeholder={isNew ? "First issue." : "e.g. Beam B3 enlarged, column grid shifted."} disabled={busy} />
      </div>
      {isNew && (
        <div className="grid gap-1.5">
          <Label htmlFor="d-desc">Description (optional)</Label>
          <Textarea id="d-desc" rows={2} value={v.description} onChange={set("description")} maxLength={1020} disabled={busy} />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="d-file">File</Label>
        <input ref={file} id="d-file" type="file" accept={ACCEPT} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} disabled={busy} aria-invalid={bad("file")} />
        <p className="text-xs text-muted-foreground">PDF, images, AutoCAD (DWG, DXF), Word, Excel or PowerPoint, up to {DOCUMENT_MAX_BYTES / 1024 / 1024} MB.{fileName ? ` Chosen: ${fileName}` : ""}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />} {isNew ? "Add drawing" : "Add revision"}
        </Button>
      </div>
    </form>
  );
}
