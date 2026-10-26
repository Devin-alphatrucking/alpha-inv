"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GOOGLE_MESSAGES } from "@/lib/flows/google-messages";
import { safeCallbackPath } from "@/lib/security/redirect";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** "Continue with Google". Also shows what went wrong when Google sign-in sent the person back with an error. */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const error = params.get("error");

  useEffect(() => {
    if (!error) return;
    const key = error.startsWith("google_") ? error.slice(7) : error === "AccessDenied" ? "failed" : null;
    if (key) toast.error(GOOGLE_MESSAGES[key as keyof typeof GOOGLE_MESSAGES] ?? GOOGLE_MESSAGES.failed);
  }, [error]);

  async function go() {
    setBusy(true);
    try {
      await signIn("google", { callbackUrl: safeCallbackPath(params.get("callbackUrl")) });
    } catch {
      setBusy(false);
      toast.error(GOOGLE_MESSAGES.failed);
    }
  }

  return (
    <div className="grid gap-4">
      <Button type="button" variant="outline" className="h-11 w-full gap-2.5 text-base md:h-10 md:text-sm" disabled={busy} onClick={() => void go()}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleMark />}
        {label}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or use your email
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
