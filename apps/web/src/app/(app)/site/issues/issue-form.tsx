"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ISSUE_MAX, SEVERITIES, SEVERITY_LABEL } from "@/lib/site/rules";
import { createIssueAction, updateIssueAction } from "../actions";

const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 md:h-10 md:text-sm dark:bg-input/30";

type Values = { title: string; description: string; area: string; severity: string; dueDate: string; assigneeId: string };
export const emptyIssue: Values = { title: "", description: "", area: "", severity: "MEDIUM", dueDate: "", assigneeId: "" };

/** Raise a new issue on a project, or change one that exists. */
export function IssueForm({
  projectId, issueId, initial = emptyIssue, people, onDone,
}: {
  projectId: string; issueId?: string; initial?: Values; people: { id: string; name: string }[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const bad = (f: string) => (error?.field === f ? true : undefined);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = issueId ? await updateIssueAction(issueId, v) : await createIssueAction(projectId, v);
      if (!r.ok) {
        setError({ field: r.field, message: r.error });
        return;
      }
      toast.success(issueId ? "Issue updated" : "Issue raised");
      if (!issueId) {
        setV(emptyIssue);
        if ("id" in r && typeof r.id === "string") {
          router.push(`/site/issues/${r.id}`);
          return;
        }
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor="issue-title">What is wrong?</Label>
        <Input id="issue-title" value={v.title} onChange={set("title")} maxLength={ISSUE_MAX.title + 20} aria-invalid={bad("title")} placeholder="e.g. Honeycombing in column C4" disabled={pending} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="issue-desc">Details</Label>
        <Textarea id="issue-desc" rows={3} value={v.description} onChange={set("description")} aria-invalid={bad("description")} placeholder="What you saw and what needs to be done." disabled={pending} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="issue-area">Where on site</Label>
          <Input id="issue-area" value={v.area} onChange={set("area")} maxLength={ISSUE_MAX.area + 20} aria-invalid={bad("area")} placeholder="Tower A, level 3" disabled={pending} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-sev">How serious</Label>
          <select id="issue-sev" className={selectClass} value={v.severity} onChange={set("severity")} disabled={pending}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-due">Fix by</Label>
          <Input id="issue-due" type="date" value={v.dueDate} onChange={set("dueDate")} aria-invalid={bad("dueDate")} disabled={pending} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="issue-who">Given to</Label>
          <select id="issue-who" className={selectClass} value={v.assigneeId} onChange={set("assigneeId")} disabled={pending} aria-invalid={bad("assigneeId")}>
            <option value="">Nobody yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : issueId ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {issueId ? "Save changes" : "Raise issue"}
        </Button>
      </div>
    </form>
  );
}
