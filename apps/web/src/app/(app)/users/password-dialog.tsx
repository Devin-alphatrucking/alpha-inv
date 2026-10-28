"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepUpDialog } from "@/components/step-up-dialog";
import { sendUserResetLinkAction, setUserPasswordAction } from "./password-actions";

export type PasswordTarget = { id: string; name: string; email: string; sharedWithOtherCompanies: boolean };

/**
 * Help a colleague who is locked out. "Email a reset link" always works (they choose their own password). "Set a new
 * password" is for people who belong to this company only; it asks the administrator for an emailed code first.
 */
export function PasswordDialog({ target, onClose }: { target: PasswordTarget | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [pending, start] = useTransition();

  function close() {
    setPassword("");
    setError(null);
    setNeedCode(false);
    onClose();
  }

  function setNow() {
    if (!target) return;
    setError(null);
    start(async () => {
      const r = await setUserPasswordAction(target.id, password);
      if (r.ok) {
        toast.success(r.message ?? "Password changed");
        close();
      } else if (r.needsCode) setNeedCode(true);
      else setError({ message: r.error, field: r.field });
    });
  }

  async function setWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!target) return { ok: false, error: "Nobody is selected." };
    const r = await setUserPasswordAction(target.id, password, code);
    if (!r.ok) return { ok: false, error: r.error };
    toast.success(r.message ?? "Password changed");
    close();
    return { ok: true };
  }

  function sendLink() {
    if (!target) return;
    setError(null);
    start(async () => {
      const r = await sendUserResetLinkAction(target.id);
      if (r.ok) {
        toast.success(r.message ?? "Reset link sent");
        close();
      } else setError({ message: r.error });
    });
  }

  return (
    <>
      <Dialog open={Boolean(target) && !needCode} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password for {target?.name}</DialogTitle>
            <DialogDescription>{target?.email}</DialogDescription>
          </DialogHeader>

          <section className="grid gap-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" aria-hidden /> Email a reset link
            </p>
            <p className="text-xs text-muted-foreground">We email them a link and a 6-digit code to choose their own new password. You never see it. Recommended.</p>
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={sendLink} disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Send reset link
            </Button>
          </section>

          <section className="grid gap-2 rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" aria-hidden /> Set a new password now
            </p>
            {target?.sharedWithOtherCompanies ? (
              <p className="text-xs text-muted-foreground">
                {target.name} also belongs to other companies, and a password is one per person, so only they (or a reset link) can change it.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">You type it and tell them. They are signed out of every device and emailed that it changed. We ask you for an emailed code first.</p>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="text-xs text-muted-foreground">At least 10 characters.</p>
                  {error?.field === "password" && <p className="text-xs text-destructive">{error.message}</p>}
                </div>
                <Button type="button" size="sm" className="w-fit" onClick={setNow} disabled={pending || password.length === 0}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Set password
                </Button>
              </>
            )}
          </section>
          {error && error.field !== "password" && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        </DialogContent>
      </Dialog>

      <StepUpDialog open={needCode} onOpenChange={(o) => !o && setNeedCode(false)} action="Change a colleague's password" onConfirm={setWithCode} />
    </>
  );
}
