// Rules for uploading many invoices in one go. Pure functions, unit-tested (bulk-queue.test.ts). The page sends the files
// one by one through the same endpoint a single upload uses, so every existing check (plan, page quota, same-file and
// same-invoice-number protection, project access) applies to each file exactly as before.

export const BULK_MAX_FILES = 25;
export const BULK_CONCURRENCY = 2; // two at a time keeps the AI service happy and the list moving
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type FileLike = { name: string; size: number; type: string; lastModified?: number };

export type ItemState = "waiting" | "reading" | "done" | "failed" | "skipped";

export type QueueItem<F extends FileLike = FileLike> = {
  id: string;
  file: F;
  state: ItemState;
  /** Set when done: the draft invoice to review. */
  invoiceId?: string;
  /** Set when failed or skipped: what to tell the person. */
  message?: string;
};

const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);
const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg"]);

/** Why a file cannot be used, or null when it can. A browser sometimes reports no type, so the extension counts too. */
export function checkFile(file: FileLike): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.has(ext)) return "Only PDF, JPG or PNG files are supported.";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > MAX_FILE_BYTES) return "The file is larger than 20 MB.";
  return null;
}

const TYPE_BY_EXT: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** The type to send for a file: the browser's, or (when it gives none, as some do for files from other apps) the one the extension implies. */
export function inferType(file: Pick<FileLike, "name" | "type">): string {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  return TYPE_BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? file.type;
}

const keyOf =(f: FileLike) => `${f.name}|${f.size}|${f.lastModified ?? 0}`;

/**
 * Adds files to a waiting list: unsupported, empty, oversized and repeated files are turned away (with a reason), and the
 * list never grows past BULK_MAX_FILES. Returns the new list and what was refused.
 */
export function addFiles<F extends FileLike>(existing: QueueItem<F>[], incoming: F[], nextId: () => string): { items: QueueItem<F>[]; rejected: { name: string; reason: string }[] } {
  const items = [...existing];
  const seen = new Set(items.map((i) => keyOf(i.file)));
  const rejected: { name: string; reason: string }[] = [];
  for (const file of incoming) {
    const problem = checkFile(file);
    if (problem) {
      rejected.push({ name: file.name, reason: problem });
      continue;
    }
    if (seen.has(keyOf(file))) {
      rejected.push({ name: file.name, reason: "Already in the list." });
      continue;
    }
    if (items.length >= BULK_MAX_FILES) {
      rejected.push({ name: file.name, reason: `Only ${BULK_MAX_FILES} files at a time.` });
      continue;
    }
    seen.add(keyOf(file));
    items.push({ id: nextId(), file, state: "waiting" });
  }
  return { items, rejected };
}

/** Errors after which trying the next file is pointless: the plan or the monthly page limit is the problem, not the file. */
const STOP_CODES = new Set(["PLAN_LOCKED", "PLAN_001", "QUOTA_001", "AUTH_001", "PERMISSION_001"]);
export const isStopCode = (code: string | undefined | null) => Boolean(code && STOP_CODES.has(code));

export type Outcome = { ok: true; invoiceId: string } | { ok: false; message: string; code?: string };

/**
 * Runs the waiting items through `work`, `concurrency` at a time. Calls `onChange` as each item moves on.
 *  - `isCancelled()` is checked before each new file starts: files already being read finish, the rest become "skipped".
 *  - After a stop-code error (plan locked, page limit reached, signed out) nothing new starts; the rest become "skipped" with the reason.
 * Resolves when every item is settled. Never throws: a `work` that throws counts as a failed item.
 */
export async function runQueue<F extends FileLike>(
  items: QueueItem<F>[],
  work: (item: QueueItem<F>) => Promise<Outcome>,
  opts: { concurrency?: number; isCancelled?: () => boolean; onChange: (id: string, patch: Partial<QueueItem<F>>) => void },
): Promise<void> {
  const waiting = items.filter((i) => i.state === "waiting");
  const concurrency = Math.max(1, opts.concurrency ?? BULK_CONCURRENCY);
  let next = 0;
  let stopReason: string | null = null;

  async function lane() {
    for (;;) {
      const item = waiting[next++];
      if (!item) return;
      if (stopReason) {
        opts.onChange(item.id, { state: "skipped", message: stopReason });
        continue;
      }
      if (opts.isCancelled?.()) {
        opts.onChange(item.id, { state: "skipped", message: "Stopped before this one was read." });
        continue;
      }
      opts.onChange(item.id, { state: "reading", message: undefined });
      let outcome: Outcome;
      try {
        outcome = await work(item);
      } catch (error) {
        outcome = { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
      }
      if (outcome.ok) {
        opts.onChange(item.id, { state: "done", invoiceId: outcome.invoiceId, message: undefined });
      } else {
        opts.onChange(item.id, { state: "failed", message: outcome.message });
        if (isStopCode(outcome.code) && !stopReason) stopReason = `Not tried: ${outcome.message}`;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, waiting.length) }, lane));
}

export function summarise(items: QueueItem[]) {
  const count = (s: ItemState) => items.filter((i) => i.state === s).length;
  const waiting = count("waiting");
  const reading = count("reading");
  const done = count("done");
  const failed = count("failed");
  const skipped = count("skipped");
  const settled = done + failed + skipped;
  return { total: items.length, waiting, reading, done, failed, skipped, settled, finished: items.length > 0 && waiting === 0 && reading === 0 };
}

/** Bytes as "340 KB" / "1.2 MB". */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
