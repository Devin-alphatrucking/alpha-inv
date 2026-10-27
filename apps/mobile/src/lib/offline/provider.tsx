import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useSession } from "@/lib/session";
import { photoFiles, queueStorage } from "./device";
import { createQueue, discard, retry as retryItem, saveAndSend, syncAll, type Outcome, type QueueItem, type Sender } from "./queue";

type SaveInput = Parameters<typeof saveAndSend>[3];

type Offline = {
  /** What is waiting for this person and company (including items that need a look). */
  items: QueueItem[];
  syncing: boolean;
  /** Keeps the item on the phone and sends it now; says whether it went, is waiting for signal, or was refused. */
  save(input: Omit<SaveInput, "userId" | "companyId">): Promise<Outcome>;
  syncNow(): Promise<void>;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
};

const Ctx = createContext<Offline | null>(null);
const RETRY_EVERY_MS = 30_000;

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { client, me, status } = useSession();
  const queue = useMemo(() => createQueue(queueStorage), []);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const running = useRef(false);
  const userId = me?.user.id ?? null;
  const companyId = me?.company.id ?? null;

  const refresh = useCallback(async () => {
    setItems(userId && companyId ? await queue.forPerson(userId, companyId) : []);
  }, [queue, userId, companyId]);

  const syncNow = useCallback(async () => {
    if (running.current || !userId || !companyId) return;
    running.current = true;
    setSyncing(true);
    try {
      await syncAll(queue, photoFiles, client as unknown as Sender, { userId, companyId });
    } finally {
      running.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [queue, client, userId, companyId, refresh]);

  // On sign-in, when the app comes back to the front, and every half minute while something waits.
  useEffect(() => {
    if (status !== "signedIn") return;
    void refresh().then(syncNow);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void syncNow());
    return () => sub.remove();
  }, [status, refresh, syncNow]);

  const waiting = items.some((i) => i.state === "waiting");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void syncNow(), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, syncNow]);

  const value = useMemo<Offline>(
    () => ({
      items,
      syncing,
      async save(input) {
        if (!userId || !companyId) throw new Error("Please sign in again.");
        const outcome = await saveAndSend(queue, photoFiles, client as unknown as Sender, { ...input, userId, companyId });
        await refresh();
        return outcome;
      },
      syncNow,
      async retry(id) {
        await retryItem(queue, id);
        await syncNow();
      },
      async discard(id) {
        await discard(queue, photoFiles, id);
        await refresh();
      },
    }),
    [items, syncing, queue, client, userId, companyId, refresh, syncNow],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOffline(): Offline {
  const o = useContext(Ctx);
  if (!o) throw new Error("useOffline must be used inside OfflineProvider");
  return o;
}
