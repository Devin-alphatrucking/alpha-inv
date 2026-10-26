"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LockOpen, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_MAX, WEATHER_CHOICES } from "@/lib/site/rules";
import { reopenReportAction, saveReportAction, submitReportAction } from "./actions";

export type ReportFormValues = { weather: string; workDone: string; labourCount: string; machinery: string; materialsUsed: string; problems: string; safetyNote: string };

/** One day's report for one project. A draft can be saved as often as needed; submitting locks it (a project manager can reopen it). */
export function ReportForm({
  projectId, date, reportId, status, values, canEdit, canSubmit, canReopen,
}: {
  projectId: string; date: string; reportId: string | null; status: "DRAFT" | "SUBMITTED" | null; values: ReportFormValues; canEdit: boolean; canSubmit: boolean; canReopen: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(values);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof ReportFormValues) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const bad = (f: string) => (error?.field === f ? true : undefined);

  function save(thenSubmit: boolean) {
    setError(null);
    start(async () => {
      const r = await saveReportAction(projectId, { reportDate: date, ...v });
      if (!r.ok) {
        setError({ field: r.field, message: r.error });
        toast.error(r.error);
        return;
      }
      if (thenSubmit) {
        const s = await submitReportAction(r.id);
        if (!s.ok) {
          toast.error(s.error);
          router.refresh();
          return;
        }
        toast.success("Report submitted");
      } else toast.success("Draft saved");
      router.refresh();
    });
  }

  function reopen() {
    if (!reportId) return;
    start(async () => {
      const r = await reopenReportAction(reportId);
      if (r.ok) {
        toast.success("Report reopened for changes");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const locked = !canEdit;
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="weather">Weather</Label>
          <Input id="weather" list="weather-choices" value={v.weather} onChange={set("weather")} maxLength={REPORT_MAX.weather} disabled={locked || pending} aria-invalid={bad("weather")} placeholder="Clear, cloudy, rain…" />
          <datalist id="weather-choices">{WEATHER_CHOICES.map((w) => <option key={w} value={w} />)}</datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="labour">Workers on site</Label>
          <Input id="labour" inputMode="numeric" value={v.labourCount} onChange={set("labourCount")} disabled={locked || pending} aria-invalid={bad("labourCount")} placeholder="e.g. 24" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="work">Work done today</Label>
        <Textarea id="work" rows={5} value={v.workDone} onChange={set("workDone")} maxLength={REPORT_MAX.workDone + 200} disabled={locked || pending} aria-invalid={bad("workDone")} placeholder="What was done, where, and how far it got." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="mach">Machinery used</Label>
          <Textarea id="mach" rows={2} value={v.machinery} onChange={set("machinery")} disabled={locked || pending} aria-invalid={bad("machinery")} placeholder="Excavator, mixer, crane…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mat">Materials used or received</Label>
          <Textarea id="mat" rows={2} value={v.materialsUsed} onChange={set("materialsUsed")} disabled={locked || pending} aria-invalid={bad("materialsUsed")} placeholder="Cement 40 bags, steel 2 t…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="prob">Problems or delays</Label>
          <Textarea id="prob" rows={2} value={v.problems} onChange={set("problems")} disabled={locked || pending} aria-invalid={bad("problems")} placeholder="Anything that held work up. Raise an issue for things that need fixing." />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="safe">Safety note</Label>
          <Textarea id="safe" rows={2} value={v.safetyNote} onChange={set("safetyNote")} disabled={locked || pending} aria-invalid={bad("safetyNote")} placeholder="Toolbox talk, near misses, incidents." />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {reportId ? "Save changes" : "Save draft"}
          </Button>
        )}
        {canEdit && canSubmit && (
          <Button type="button" disabled={pending} onClick={() => save(true)}>
            <CheckCircle2 className="size-4" aria-hidden /> Save and submit
          </Button>
        )}
        {canReopen && (
          <Button type="button" variant="outline" disabled={pending} onClick={reopen}>
            <LockOpen className="size-4" aria-hidden /> Reopen for changes
          </Button>
        )}
        {status === "SUBMITTED" && !canEdit && <span className="text-sm text-muted-foreground">Submitted. A project manager can reopen it.</span>}
      </div>
    </form>
  );
}
