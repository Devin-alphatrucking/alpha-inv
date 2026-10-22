"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resetApplicationData } from "./actions";

const CONFIRMATION = "RESET DATA";

export function ResetDataPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = password.length > 0 && confirmation === CONFIRMATION;

  function close() {
    if (pending) return;
    setOpen(false);
    setPassword("");
    setConfirmation("");
  }

  function resetData() {
    if (!ready) return;
    startTransition(async () => {
      const result = await resetApplicationData({ password, confirmation });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
      setPassword("");
      setConfirmation("");
      toast.success(
        result.fileCleanupFailures > 0
          ? `Application data reset. ${result.fileCleanupFailures} uploaded file(s) require manual cleanup.`
          : "Application data has been reset."
      );
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <Trash2 className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Reset application data</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Permanently remove all business records, logs, projects, and other users. Your current admin account is preserved.
            </p>
          </div>
        </div>
        <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" />
          Reset all data
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <DialogTitle>Reset all application data?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              This cannot be undone. Invoices, payments, projects, vendors, categories, materials, logs, assignments, and other user accounts will be deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="reset-password">Current admin password</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reset-confirmation">
                Type <span className="font-mono font-semibold">{CONFIRMATION}</span>
              </Label>
              <Input
                id="reset-confirmation"
                value={confirmation}
                disabled={pending}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!ready || pending} onClick={resetData}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Permanently reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
