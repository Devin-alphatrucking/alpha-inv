"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ signupEnabled }: { signupEnabled: boolean }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!email.trim() || !password) {
      toast.error("Enter email and password");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        const code = (result as { code?: string }).code;
        if (code === "email_not_verified") {
          setNeedsVerification(true);
          toast.error("Please confirm your email first.");
        } else if (code === "rate_limited") {
          toast.error("Too many attempts. Please wait a few minutes and try again.");
        } else {
          setNeedsVerification(false);
          toast.error("Invalid email or password");
        }
        return;
      }

      // Full navigation so the session cookie is picked up on tunnel hosts.
      const callbackUrl = searchParams.get("callbackUrl") || "/";
      window.location.assign(callbackUrl);
    } catch {
      toast.error("Sign-in failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      method="post"
      action="#"
      onSubmit={onSubmit}
      className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-6"
      noValidate
    >
      <p className="mb-5 text-sm text-muted-foreground">
        Sign in to your account
      </p>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 text-base md:h-10 md:text-sm"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 text-base md:h-10 md:text-sm"
            required
          />
          <div className="text-right">
            <Link href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Forgot your password?
            </Link>
          </div>
        </div>

        {needsVerification && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Your email address has not been confirmed yet. Open the link we emailed you, or{" "}
            <Link href="/verify-email" className="font-medium underline underline-offset-2">
              send a new one
            </Link>
            .
          </p>
        )}

        <Button
          type="submit"
          className="mt-1 h-11 w-full text-base md:h-10 md:text-sm"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
      </div>

      {signupEnabled && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">
            Create a company account
          </Link>
        </p>
      )}
    </form>
  );
}
