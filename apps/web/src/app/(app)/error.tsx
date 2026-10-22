"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home, ArrowLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route error caught by error boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-lg border-destructive/20">
        <CardHeader className="flex flex-col items-center gap-2 pb-2">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">
            Something went wrong
          </CardTitle>
          <CardDescription className="text-sm">
            We encountered an unexpected error loading this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {error.message && (
            <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground font-mono break-all text-left">
              {error.message}
              {error.digest && (
                <div className="mt-1 text-[10px] text-muted-foreground/70">
                  Digest: {error.digest}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              type="button"
              variant="default"
              className="gap-2"
              onClick={() => reset()}
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="size-4" />
              Go back
            </Button>
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: "ghost", className: "gap-2" })}
            >
              <Home className="size-4" />
              Dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
