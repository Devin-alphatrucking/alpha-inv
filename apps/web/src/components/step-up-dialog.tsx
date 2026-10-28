"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/code-input";
import { sendStepUpCodeAction } from "@/app/(app)/step-up-actions";

export type StepUpAction = "Remove a person from the company" | "Close the company" | "Delete your account" | "Record a payment run" | "Change a colleague's password";

/**
 * "Confirm it is you": emails a code when it opens, then hands the typed code to `onConfirm`, which runs the risky action again
 * with it. `onConfirm` returns { ok: true } to close, or { ok: false, error } to keep the dialog open with the reason.
 */
export function StepUpDialog({
  open,
  onOpenChange,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: StepUpAction;
  onConfirm: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, start] = useTransition();
  const sentFor = useRef<boolean>(false);

  function send() {
    setError(null);
    start(async () => {
      const r = await sendStepUpCodeAction(action);
      if (r.ok) {
        setSentTo(r.sentTo);
        setWait(30);
      } else setError(r.error);
    });
  }

  // Send one code each time the dialog opens.
  useEffect(() => {
    if (open && !sentFor.current) {
      sentFor.current = true;
      setCode("");
      setSentTo(null);
      setError(null);
      send();
    }
    if (!open) sentFor.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function confirm() {
    if (code.length !== 6) return;
    setError(null);
    start(async () => {
      const r = await onConfirm(code);
      if (r.ok) onOpenChange(false);
      else {
        setError(r.error);
        setCode("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="gap-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MailCheck className="size-5 text-emerald-600" aria-hidden /> Confirm it is you
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {sentTo ? <>We sent a 6-digit code to <span className="font-medium text-foreground">{sentTo}</span>. Enter it to: {action.toLowerCase()}.</> : `Sending a code to your email, to: ${action.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
          className="grid gap-3"
        >
          <Label htmlFor="stepup-code" className="sr-only">
            Code
          </Label>
          <CodeInput id="stepup-code" value={code} onChange={setCode} disabled={pending} autoFocus invalid={Boolean(error)} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={send} disabled={pending || wait > 0}>
              {wait > 0 ? `Send again in ${wait}s` : "Send a new code"}
            </Button>
            <Button type="submit" size="sm" disabled={pending || code.length !== 6}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
