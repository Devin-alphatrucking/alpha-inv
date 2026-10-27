"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Options = { title: string; description: string; confirmLabel?: string; cancelLabel?: string; variant?: "destructive" | "default" };
type Ask = (options: Options) => Promise<boolean>;

const Ctx = createContext<Ask | null>(null);

/**
 * One in-app confirmation popup for the whole app, in place of the browser's own confirm() box (which looks different on every
 * browser, cannot be styled, and is blocked in some phone browsers). `const ask = useConfirm(); if (!(await ask({ ... }))) return;`
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    resolver.current?.(false); // a second question replaces the first
    setOptions(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <Ctx.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
        title={options?.title ?? ""}
        description={options?.description ?? ""}
        confirmLabel={options?.confirmLabel ?? "Confirm"}
        cancelLabel={options?.cancelLabel ?? "Cancel"}
        variant={options?.variant ?? "default"}
        onConfirm={() => settle(true)}
      />
    </Ctx.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}
