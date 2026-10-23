"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setEmailDigestAction } from "./email-actions";

/** Administrators get one email each morning when something is overdue, due this week, or waiting for review. This switch turns it off for this person. */
export function EmailPreferences({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    const previous = on;
    setOn(next);
    start(async () => {
      const r = await setEmailDigestAction(next);
      if (r.ok) toast.success(next ? "Daily email is on" : "Daily email is off");
      else {
        setOn(previous);
        toast.error(r.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" aria-hidden /> Daily email
        </CardTitle>
        <CardDescription>
          One short email each morning, only on days when something is overdue, due in the next 7 days, or waiting for review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
          Send me the daily summary
        </label>
      </CardContent>
    </Card>
  );
}
