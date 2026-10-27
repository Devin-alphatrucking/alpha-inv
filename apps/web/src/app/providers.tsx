"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/confirm-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster richColors position="top-center" closeButton />
      </ThemeProvider>
    </SessionProvider>
  );
}
