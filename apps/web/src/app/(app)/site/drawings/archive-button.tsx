"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveDocumentAction } from "../actions";
import { useConfirm } from "@/components/confirm-provider";

export function ArchiveButton({ documentId, archived }: { documentId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const ask = useConfirm();
  async function run() {
    if (!archived && !(await ask({ title: "Archive this drawing?", description: "It disappears from the lists but its history is kept, and you can bring it back.", confirmLabel: "Archive", variant: "default" }))) return;
    setBusy(true);
    const r = await archiveDocumentAction(documentId, !archived);
    setBusy(false);
    if (r.ok) toast.success(archived ? "Drawing restored" : "Drawing archived");
    else toast.error(r.error);
    router.refresh();
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => void run()}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />} {archived ? "Restore" : "Archive"}
    </Button>
  );
}
