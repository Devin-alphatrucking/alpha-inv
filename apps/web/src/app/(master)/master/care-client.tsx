"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addFollowUpAction, addNoteAction, setFollowUpDoneAction, type MasterResult } from "./actions";

function Result({ result }: { result: MasterResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={cn("text-sm", result.ok ? "text-emerald-600" : "text-red-600")}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

/** Write a note about a company (what was said on a call, what they asked for). */
export function NoteForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MasterResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    setResult(null);
    start(async () => {
      const r = await addNoteAction(orgId, { body });
      setResult(r);
      if (r.ok) {
        form.reset();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <Label htmlFor="note-body" className="text-xs text-muted-foreground">Add a note</Label>
      <Textarea id="note-body" name="body" required maxLength={2000} rows={3} placeholder="For example: spoke to the site manager, wants the phone app for four engineers" />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="mr-2 size-3.5 animate-spin" />}Save note
        </Button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Remind the team to do something on a day. */
export function FollowUpForm({ orgId, today }: { orgId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MasterResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setResult(null);
    start(async () => {
      const r = await addFollowUpAction(orgId, { task: String(data.get("task") ?? ""), dueOn: String(data.get("dueOn") ?? "") });
      setResult(r);
      if (r.ok) {
        form.reset();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="fu-task" className="text-xs text-muted-foreground">What to do</Label>
          <Input id="fu-task" name="task" required maxLength={200} placeholder="Call about the trial ending" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="fu-due" className="text-xs text-muted-foreground">On</Label>
          <Input id="fu-due" name="dueOn" type="date" required min={today} defaultValue={today} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="mr-2 size-3.5 animate-spin" />}Add follow-up
        </Button>
        <Result result={result} />
      </div>
    </form>
  );
}

export function DoneButton({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setFollowUpDoneAction(id, !done);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {pending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
        {done ? "Open again" : "Done"}
      </Button>
    </span>
  );
}
