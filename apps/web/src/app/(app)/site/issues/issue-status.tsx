"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, type IssueState } from "@/lib/site/rules";
import { setIssueStatusAction } from "../actions";

const VERB: Record<IssueState, string> = { OPEN: "Reopen", IN_PROGRESS: "Start work", FIXED: "Mark fixed", CLOSED: "Close (accept the fix)" };

/** The next steps this person may take on an issue. */
export function IssueStatusButtons({ issueId, status, next }: { issueId: string; status: IssueState; next: IssueState[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<IssueState | null>(null);

  async function move(to: IssueState) {
    setBusy(to);
    const r = await setIssueStatusAction(issueId, to);
    setBusy(null);
    if (r.ok) toast.success(`Now ${STATUS_LABEL[to].toLowerCase()}`);
    else toast.error(r.error);
    router.refresh();
  }

  if (next.length === 0) return <p className="text-sm text-muted-foreground">{status === "CLOSED" ? "Closed. A project manager can reopen it." : "You cannot change this issue."}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {next.map((to) => (
        <Button key={to} type="button" size="sm" variant={to === "CLOSED" || to === "FIXED" ? "default" : "outline"} disabled={busy !== null} onClick={() => void move(to)}>
          {busy === to && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {status === "FIXED" && to === "OPEN" ? "Not fixed: reopen" : VERB[to]}
        </Button>
      ))}
    </div>
  );
}
