"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleDashed, FileText, Loader2, MinusCircle, Plus, RotateCw, Square, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addFiles, BULK_MAX_FILES, formatBytes, inferType, runQueue, summarise, type Outcome, type QueueItem } from "@/lib/invoices/bulk-queue";

type Item = QueueItem<File>;

let counter = 0;
const nextId = () => `f${++counter}`;

const ACCEPT = "application/pdf,image/png,image/jpeg,image/jpg";

/** Sends one file through the same endpoint a single upload uses, and turns the answer into an Outcome. */
async function uploadOne(file: File, projectId: string, categoryId: string): Promise<Outcome> {
  const body = new FormData();
  const type = inferType(file);
  body.append("file", type === file.type ? file : new File([file], file.name, { type }));
  body.append("projectId", projectId);
  body.append("categoryId", categoryId);
  try {
    const res = await fetch("/api/invoices/upload", { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; invoiceId?: string };
    if (res.ok && data.invoiceId) return { ok: true, invoiceId: data.invoiceId };
    return { ok: false, message: data.error ?? `Upload failed (${res.status}).`, code: data.code };
  } catch {
    return { ok: false, message: "Network error. Check your connection and retry this one." };
  }
}

export function BulkQueue({
  initialFiles,
  projectId,
  categoryId,
  reviewHref,
  onBusyChange,
  onExit,
}: {
  initialFiles: File[];
  projectId: string;
  categoryId: string;
  /** Where "review them" leads (the invoices list, filtered to drafts for administrators). */
  reviewHref: string;
  onBusyChange: (busy: boolean) => void;
  /** Back to the single-file screen. */
  onExit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>(() => addFiles<File>([], initialFiles, nextId).items);
  const itemsRef = useRef(items);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  const update = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback((id: string, change: Partial<Item>) => {
    update(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i)));
  }, [update]);

  // Tell the page when a batch is running (it locks the project and category pickers).
  useEffect(() => onBusyChange(running), [running, onBusyChange]);

  // Closing the tab mid-batch would leave the unread files behind.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const s = summarise(items);
  const canStart = !running && s.waiting > 0 && Boolean(projectId && categoryId);

  function add(files: File[]) {
    const result = addFiles<File>(itemsRef.current, files, nextId);
    update(result.items);
    if (result.rejected.length > 0) {
      const first = result.rejected[0];
      toast.error(result.rejected.length === 1 ? `${first.name}: ${first.reason}` : `${result.rejected.length} files were not added (${first.name}: ${first.reason})`);
    }
  }

  async function start() {
    if (!canStart) return;
    cancelled.current = false;
    setRunning(true);
    await runQueue(itemsRef.current, (item) => uploadOne(item.file, projectId, categoryId), {
      isCancelled: () => cancelled.current,
      onChange: patch,
    });
    setRunning(false);
    const done = summarise(itemsRef.current);
    if (done.failed === 0 && done.skipped === 0) toast.success(`${done.done} invoice${done.done === 1 ? "" : "s"} read. Ready for review.`);
    else toast.warning(`${done.done} read, ${done.failed + done.skipped} need attention.`);
  }

  function retry(id: string) {
    patch(id, { state: "waiting", message: undefined });
  }

  const label = (i: Item) =>
    i.state === "waiting" ? "Waiting" : i.state === "reading" ? "Reading with AI…" : i.state === "done" ? "Read. Waiting for your review." : i.state === "skipped" ? i.message ?? "Not read" : i.message ?? "Failed";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{items.length} invoice{items.length === 1 ? "" : "s"} selected</p>
          <p className="text-xs text-muted-foreground">
            {running
              ? `${s.settled} of ${s.total} finished. Keep this page open.`
              : s.finished
                ? `${s.done} read${s.failed + s.skipped > 0 ? `, ${s.failed + s.skipped} need attention` : ""}.`
                : "Each one is read by AI, then waits for you to check and save it."}
          </p>
        </div>
        {!running && (
          <Button type="button" variant="ghost" size="sm" onClick={onExit}>
            One at a time
          </Button>
        )}
      </div>

      {(running || s.settled > 0) && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.settled} aria-label="Invoices read">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${s.total ? (s.settled / s.total) * 100 : 0}%` }} />
        </div>
      )}

      <ul className="grid gap-2" aria-label="Files">
        {items.map((i) => (
          <li
            key={i.id}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5",
              i.state === "failed" && "border-destructive/40 bg-destructive/5",
              i.state === "done" && "border-emerald-500/30",
            )}
          >
            <span className="shrink-0" aria-hidden>
              {i.state === "done" ? <CheckCircle2 className="size-5 text-emerald-600" /> : i.state === "failed" ? <CircleAlert className="size-5 text-destructive" /> : i.state === "reading" ? <Loader2 className="size-5 animate-spin" /> : i.state === "skipped" ? <MinusCircle className="size-5 text-muted-foreground" /> : <CircleDashed className="size-5 text-muted-foreground" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{i.file.name}</p>
              <p className={cn("text-xs", i.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {formatBytes(i.file.size)} · {label(i)}
              </p>
            </div>
            {i.state === "done" && i.invoiceId && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/invoices/${i.invoiceId}/review`} />}>
                <FileText className="size-3.5" aria-hidden /> Review
              </Button>
            )}
            {(i.state === "failed" || i.state === "skipped") && !running && (
              <Button type="button" variant="outline" size="sm" onClick={() => retry(i.id)} aria-label={`Try ${i.file.name} again`}>
                <RotateCw className="size-3.5" aria-hidden /> Retry
              </Button>
            )}
            {i.state === "waiting" && !running && (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => update(itemsRef.current.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.file.name}`}>
                <X className="size-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button type="button" variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => (cancelled.current = true)}>
            <Square className="size-4" aria-hidden /> Stop after the current ones
          </Button>
        ) : (
          <>
            <Button type="button" size="lg" className="h-11 flex-1 gap-2 rounded-xl font-semibold" disabled={!canStart} onClick={() => void start()}>
              <UploadCloud className="size-4" aria-hidden />
              {s.waiting === 0 ? "Nothing waiting" : !projectId ? "Select a project above" : !categoryId ? "Select a category above" : s.settled > 0 ? `Read ${s.waiting} more` : `Read ${s.waiting} invoice${s.waiting === 1 ? "" : "s"}`}
            </Button>
            {items.length < BULK_MAX_FILES && (
              <Button type="button" variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => inputRef.current?.click()}>
                <Plus className="size-4" aria-hidden /> Add files
              </Button>
            )}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {!running && s.done > 0 && (
        <Button variant="secondary" className="h-11 rounded-xl" nativeButton={false} render={<Link href={reviewHref} />}>
          Review the {s.done} invoice{s.done === 1 ? "" : "s"} now
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Up to {BULK_MAX_FILES} files at a time, 20 MB each. A file already uploaded, or an invoice number already saved for that supplier, is refused with the reason. Every page read counts toward this month&apos;s AI pages, as with a single upload.</p>
    </div>
  );
}
