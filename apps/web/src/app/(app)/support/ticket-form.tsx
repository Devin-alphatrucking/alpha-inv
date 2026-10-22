"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTicketAction } from "./actions";

export function TicketForm({
  initialSubject,
  initialMessage,
  supportConfigured,
}: {
  initialSubject: string;
  initialMessage: string;
  supportConfigured: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState(initialMessage);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [done, setDone] = useState<{ reference: string; emailed: boolean } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createTicketAction({ subject, message });
      if (r.ok) setDone({ reference: r.reference, emailed: r.emailed });
      else setError({ message: r.error, field: r.field });
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 text-center">
        <CheckCircle2 className="size-9 text-emerald-600" />
        <p className="text-base font-semibold">Request sent: {done.reference}</p>
        <p className="text-sm text-muted-foreground">
          We emailed you a confirmation with this reference. {done.emailed || supportConfigured ? "Our team will reply by email." : "Our team will see it in the ticket list."}
        </p>
        <Button variant="outline" size="sm" onClick={() => { setDone(null); setSubject(""); setMessage(""); }}>
          Send another
        </Button>
      </div>
    );
  }

  const fieldError = (f: string) => (error?.field === f ? <p className="text-xs text-destructive">{error.message}</p> : null);
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="tk-subject">Title</Label>
        <Input id="tk-subject" value={subject} maxLength={120} placeholder="For example: Invoice upload fails" onChange={(e) => setSubject(e.target.value)} required />
        {fieldError("subject")}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tk-message">What happened?</Label>
        <Textarea id="tk-message" value={message} maxLength={5000} rows={7} placeholder="What were you doing, what did you expect, and what happened instead? Include any error message." onChange={(e) => setMessage(e.target.value)} required />
        {fieldError("message")}
      </div>
      {error && !error.field && <p className="text-sm text-destructive">{error.message}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Send request
        </Button>
      </div>
    </form>
  );
}
