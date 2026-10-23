"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { beginTwoFactorAction, confirmTwoFactorAction, disableTwoFactorAction, regenerateRecoveryCodesAction } from "./two-factor-actions";

type Setup = { secret: string; qrSvg: string };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  return (
    <div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p className="font-medium">Save these recovery codes now. They are shown only once.</p>
      <p className="text-muted-foreground">
        Each code works one time, if you lose your phone. Keep them somewhere safe (a password manager or a printed copy), not on the same phone.
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success("Copied");
            } catch {
              toast.error("Could not copy. Select the codes and copy them by hand.");
            }
          }}
        >
          Copy
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`Recovery codes\n\n${text}\n`], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorPanel({ enabled, recoveryLeft, isOperator }: { enabled: boolean; recoveryLeft: number; isOperator: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "regen">("idle");
  const [password, setPassword] = useState("");

  function begin() {
    setError(null);
    start(async () => {
      const r = await beginTwoFactorAction();
      if (r.ok) setSetup({ secret: r.secret, qrSvg: r.qrSvg });
      else setError(r.error);
    });
  }

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await confirmTwoFactorAction(code);
      if (r.ok) {
        setCodes(r.recoveryCodes);
        setSetup(null);
        setCode("");
        toast.success("Two-step sign-in is on");
      } else setError(r.error);
    });
  }

  function submitChange(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      if (mode === "disable") {
        const r = await disableTwoFactorAction(password, code);
        if (r.ok) {
          toast.success("Two-step sign-in is off");
          setMode("idle");
          router.refresh();
        } else setError(r.error);
      } else {
        const r = await regenerateRecoveryCodesAction(password, code);
        if (r.ok) {
          setCodes(r.recoveryCodes);
          setMode("idle");
        } else setError(r.error);
      }
      setPassword("");
      setCode("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden /> Two-step sign-in
          </CardTitle>
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "On" : "Off"}</Badge>
        </div>
        <CardDescription>
          {enabled
            ? "Signing in needs your password and a 6-digit code from your authenticator app."
            : "Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) to your password. Strongly recommended for administrators."}
          {isOperator && !enabled ? " You are a platform operator: the master console stays locked until this is on." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {codes && <RecoveryCodes codes={codes} onDone={() => (setCodes(null), router.refresh())} />}

        {!enabled && !setup && !codes && (
          <div>
            <Button onClick={begin} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Turn on two-step sign-in
            </Button>
          </div>
        )}

        {setup && (
          <form onSubmit={confirm} className="grid gap-4">
            <ol className="grid gap-3 text-sm">
              <li>1. Open your authenticator app and add an account: scan this picture, or type the key by hand.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              <div className="rounded-lg border bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <div className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Key to type by hand</span>
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              </div>
            </div>
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="tf-code">2. Type the 6-digit code the app shows</Label>
              <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || code.trim().length < 6}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Confirm and turn on
              </Button>
              <Button type="button" variant="outline" onClick={() => (setSetup(null), setError(null))}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {enabled && !codes && mode === "idle" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Recovery codes left: <span className="font-medium text-foreground">{recoveryLeft}</span>
              {recoveryLeft <= 2 ? " (running low: make new ones)" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => (setMode("regen"), setError(null))}>
                New recovery codes
              </Button>
              <Button variant="outline" size="sm" onClick={() => (setMode("disable"), setError(null))}>
                Turn off
              </Button>
            </div>
          </div>
        )}

        {enabled && mode !== "idle" && (
          <form onSubmit={submitChange} className="grid gap-3 sm:max-w-sm">
            <p className="text-sm text-muted-foreground">
              {mode === "disable" ? "To turn it off, confirm with your password and a current code." : "Confirm with your password and a current code. Your old recovery codes stop working."}
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="tf-pw">Password</Label>
              <Input id="tf-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tf-code2">Code from your app (or a recovery code)</Label>
              <Input id="tf-code2" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={pending || !password || !code}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {mode === "disable" ? "Turn off" : "Make new codes"}
              </Button>
              <Button type="button" variant="outline" onClick={() => (setMode("idle"), setError(null))}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {!setup && !enabled && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
