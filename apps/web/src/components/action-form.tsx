"use client";

import { useRef, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type FormActionResult = { ok: true } | { ok: false; error: string };

/**
 * A form that calls a server action and tells the person what happened: a toast for success, a toast with the reason for a
 * refusal (such as a duplicate), and the fields are cleared after success. The action returns a result instead of throwing,
 * so a normal "no, that already exists" never turns into the error page.
 */
export function ActionForm({
  action,
  submitLabel,
  successMessage,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  submitLabel: string;
  successMessage: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await action(data);
            if (r.ok) {
              toast.success(successMessage);
              ref.current?.reset();
            } else {
              toast.error(r.error);
            }
          } catch {
            toast.error("Something went wrong. Please try again.");
          }
        });
      }}
    >
      {children}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
