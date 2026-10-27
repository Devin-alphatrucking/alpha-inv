// Saving without a connection. What a person raises on site (an issue, a material request, a delivery) is first kept
// on the phone, then sent; a send that fails for lack of signal stays kept and is tried again later. No React Native
// imports here, so the same code is tested in Node (scripts/test-offline.ts).
//
// Sending twice is safe because every item carries a reference (its id) that the server remembers: if the reply was
// lost and the item goes again, the server hands back the first record instead of making a second one.

import { ApiError } from "../client";

export type Kind = "issue" | "request" | "delivery";
export type LocalFile = { uri: string; name: string; type: string };

export type QueueItem = {
  /** Also the reference sent to the server. 8 to 64 letters, digits, - and _. */
  id: string;
  kind: Kind;
  userId: string;
  companyId: string;
  /** What the person sees in the list ("Issue: Crack in beam B3"). */
  label: string;
  createdAt: number;
  /** The fields of the call, as the form built them (without the reference). */
  body: Record<string, unknown>;
  /** For a delivery: the order it was received against. */
  orderId?: string;
  projectId: string;
  photos: LocalFile[];
  photoArea?: string;
  /** Set once the record itself reached the server, so a retry only sends what is missing. */
  serverId?: string;
  photoBatchesDone: number;
  /** "failed" means the server said no (not a signal problem): the person must fix or discard it. */
  state: "waiting" | "failed";
  error?: string;
  attempts: number;
};

export type Storage = { read(): Promise<string | null>; write(text: string): Promise<void> };
export type Files = {
  /** Copies a picked photo somewhere the phone will not clear, and returns where. */
  keep(file: LocalFile, ref: string, index: number): Promise<LocalFile>;
  drop(file: LocalFile): Promise<void>;
};

export type Sender = {
  raiseIssue(input: Record<string, unknown>): Promise<{ ok: true; id: string }>;
  raiseRequest(input: Record<string, unknown>): Promise<{ ok: true; id: string; warning?: string }>;
  recordDelivery(orderId: string, input: Record<string, unknown>): Promise<{ ok: true; id: string }>;
  uploadSitePhotos(files: LocalFile[], target: Record<string, string | undefined>): Promise<{ ok: true; added: number; skipped: string[] }>;
};

export const PHOTOS_PER_BATCH = 10;
export const MAX_QUEUED = 100;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newRef(random: () => number = Math.random, now: () => number = Date.now): string {
  let tail = "";
  for (let i = 0; i < 12; i++) tail += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${now().toString(36)}-${tail}`;
}

/** No signal, a server that could not answer, or too many requests: the item is fine and is simply tried later. */
export function isTemporary(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

/** The session ended: nothing can be sent until the person signs in again, but nothing is wrong with the item. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function createQueue(storage: Storage) {
  let items: QueueItem[] | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  /** One change at a time, so two quick saves can never overwrite each other. */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  async function load(): Promise<QueueItem[]> {
    if (items) return items;
    try {
      const text = await storage.read();
      const parsed = text ? JSON.parse(text) : [];
      items = Array.isArray(parsed) ? (parsed as QueueItem[]).filter((i) => i && typeof i.id === "string" && typeof i.kind === "string") : [];
    } catch {
      items = []; // a damaged file must not stop the app; the person can raise it again
    }
    return items;
  }

  async function persist() {
    await storage.write(JSON.stringify(items ?? []));
  }

  return {
    all: () => exclusive(async () => [...(await load())]),
    forPerson: (userId: string, companyId: string) => exclusive(async () => (await load()).filter((i) => i.userId === userId && i.companyId === companyId)),
    get: (id: string) => exclusive(async () => (await load()).find((i) => i.id === id) ?? null),

    add: (item: QueueItem) =>
      exclusive(async () => {
        const list = await load();
        if (list.length >= MAX_QUEUED) throw new Error("Too many items are waiting to be sent. Connect to the internet to send them first.");
        list.push(item);
        await persist();
      }),

    /** Changes one item (its progress or state). A missing item (discarded meanwhile) is left missing. */
    update: (id: string, change: Partial<QueueItem>) =>
      exclusive(async () => {
        const list = await load();
        const at = list.findIndex((i) => i.id === id);
        if (at < 0) return null;
        list[at] = { ...list[at], ...change };
        await persist();
        return list[at];
      }),

    remove: (id: string) =>
      exclusive(async () => {
        const list = await load();
        const at = list.findIndex((i) => i.id === id);
        if (at < 0) return null;
        const [gone] = list.splice(at, 1);
        await persist();
        return gone;
      }),
  };
}

export type Queue = ReturnType<typeof createQueue>;

export type Outcome =
  | { kind: "sent"; serverId: string; warning?: string; skipped: string[] }
  | { kind: "offline" }
  | { kind: "signedOut" }
  | { kind: "rejected"; message: string };

function mainCall(item: QueueItem, api: Sender) {
  const body = { ...item.body, clientRef: item.id };
  switch (item.kind) {
    case "issue":
      return api.raiseIssue(body);
    case "request":
      return api.raiseRequest(body);
    case "delivery":
      return api.recordDelivery(item.orderId ?? "", body);
  }
}

/**
 * Sends one item: the record first, then its photos in batches of ten. Progress is saved after each step, so after a
 * dropped connection the next try carries on from there. Does not remove the item; the caller decides (see `finish`).
 */
export async function sendItem(queue: Queue, item: QueueItem, api: Sender): Promise<Outcome> {
  let current = item;
  const skipped: string[] = [];
  let warning: string | undefined;
  try {
    if (!current.serverId) {
      const made = await mainCall(current, api);
      warning = (made as { warning?: string }).warning;
      current = (await queue.update(current.id, { serverId: made.id, attempts: current.attempts + 1 })) ?? { ...current, serverId: made.id };
    }
    const serverId = current.serverId as string;
    const batches = Math.ceil(current.photos.length / PHOTOS_PER_BATCH);
    for (let n = current.photoBatchesDone; n < batches; n++) {
      const files = current.photos.slice(n * PHOTOS_PER_BATCH, (n + 1) * PHOTOS_PER_BATCH);
      const target: Record<string, string | undefined> = { projectId: current.projectId, clientRef: `${current.id}-b${n}`, area: current.photoArea };
      if (current.kind === "issue") target.issueId = serverId;
      else if (current.kind === "delivery") target.receiptId = serverId;
      else break; // a request has no photos
      const r = await api.uploadSitePhotos(files, target);
      skipped.push(...r.skipped);
      current = (await queue.update(current.id, { photoBatchesDone: n + 1 })) ?? { ...current, photoBatchesDone: n + 1 };
    }
    return { kind: "sent", serverId, warning, skipped };
  } catch (error) {
    if (isSignedOut(error)) return { kind: "signedOut" };
    if (isTemporary(error)) {
      await queue.update(current.id, { attempts: current.attempts + 1 });
      return { kind: "offline" };
    }
    const message = error instanceof ApiError ? error.message : "Could not be sent.";
    // Photos failing after the record was saved is not a reason to lose the record: keep what is left for a retry.
    await queue.update(current.id, { state: "failed", error: message, attempts: current.attempts + 1 });
    return { kind: "rejected", message };
  }
}

/** The item is done: take it out of the queue and delete its local photo copies. */
export async function finish(queue: Queue, files: Files, item: QueueItem) {
  await queue.remove(item.id);
  for (const p of item.photos) await files.drop(p).catch(() => undefined);
}

/** Tries every waiting item of this person, oldest first. Stops at the first sign of no signal: the rest would fail the same way. */
export async function syncAll(queue: Queue, files: Files, api: Sender, who: { userId: string; companyId: string }) {
  const result = { sent: 0, failed: 0, left: 0, offline: false, signedOut: false };
  const mine = (await queue.forPerson(who.userId, who.companyId)).filter((i) => i.state === "waiting").sort((a, b) => a.createdAt - b.createdAt);
  for (const [index, item] of mine.entries()) {
    const outcome = await sendItem(queue, item, api);
    if (outcome.kind === "sent") {
      await finish(queue, files, item);
      result.sent++;
    } else if (outcome.kind === "rejected") {
      result.failed++;
    } else {
      result.left = mine.length - index;
      result.offline = outcome.kind === "offline";
      result.signedOut = outcome.kind === "signedOut";
      break;
    }
  }
  return result;
}

/** Puts a failed item back to waiting (after the person has had a look), so the next sync tries it again. */
export function retry(queue: Queue, id: string) {
  return queue.update(id, { state: "waiting", error: undefined });
}

export async function discard(queue: Queue, files: Files, id: string) {
  const gone = await queue.remove(id);
  if (gone) for (const p of gone.photos) await files.drop(p).catch(() => undefined);
}

/**
 * The form's own save: keep the item, try to send it at once. A refusal (something to fix in the form) is taken
 * back out so nothing stuck is left behind; no signal leaves it kept and says so.
 */
export async function saveAndSend(
  queue: Queue,
  files: Files,
  api: Sender,
  input: Omit<QueueItem, "id" | "createdAt" | "photos" | "photoBatchesDone" | "state" | "attempts"> & { photos: LocalFile[] },
  ids: { ref?: string; now?: () => number } = {},
): Promise<Outcome> {
  const id = ids.ref ?? newRef();
  const kept: LocalFile[] = [];
  for (const [i, p] of input.photos.entries()) kept.push(await files.keep(p, id, i));
  const item: QueueItem = { ...input, photos: kept, id, createdAt: (ids.now ?? Date.now)(), photoBatchesDone: 0, state: "waiting", attempts: 0 };
  try {
    await queue.add(item);
  } catch (e) {
    for (const p of kept) await files.drop(p).catch(() => undefined);
    throw e;
  }
  const outcome = await sendItem(queue, item, api);
  if (outcome.kind === "sent") await finish(queue, files, item);
  // The record was refused before anything was saved: the form shows why and keeps what the person typed.
  else if (outcome.kind === "rejected" && !(await queue.get(id))?.serverId) await discard(queue, files, id);
  return outcome;
}
