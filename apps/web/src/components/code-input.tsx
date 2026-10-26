"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Where a person types the 6-digit code from an email. One plain field (so paste works, and phones offer "from messages"):
 * digits only, large and spaced, and it tells the phone this is a one-time code.
 */
export function CodeInput({ id, value, onChange, disabled, autoFocus, invalid, className }: { id: string; value: string; onChange: (digits: string) => void; disabled?: boolean; autoFocus?: boolean; invalid?: boolean; className?: string }) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={invalid ? true : undefined}
      aria-label="6-digit code"
      className={cn("h-12 text-center font-mono text-2xl tracking-[0.5em] tabular-nums", className)}
    />
  );
}
