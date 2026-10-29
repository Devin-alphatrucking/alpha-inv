"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeCallbackPath } from "@/lib/security/redirect";
import { GoogleButton } from "@/components/google-button";
import { rememberWelcome } from "@/components/welcome-greeting";

export function LoginForm({ signupEnabled, googleEnabled = false }: { signupEnabled: boolean; googleEnabled?: boolean }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  // After the password is right, an account with two-step sign-in asks for the code in a second step.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

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
        totp: code.trim(),
        redirect: false,
      });

      if (result?.error) {
        const errorCode = (result as { code?: string }).code;
        if (errorCode === "totp_required") {
          setNeedsCode(true);
          toast.message("Enter the 6-digit code from your authenticator app.");
        } else if (errorCode === "totp_invalid") {
          setNeedsCode(true);
          setCode("");
          toast.error("That code is not right or was already used. Wait for the next one, or use a recovery code.");
        } else if (errorCode === "email_not_verified") {
          setNeedsVerification(true);
          toast.error("Please confirm your email first.");
        } else if (errorCode === "rate_limited") {
          toast.error("Too many attempts. Please wait a few minutes and try again.");
        } else {
          setNeedsVerification(false);
          toast.error("Invalid email or password");
        }
        return;
      }

      rememberWelcome("back");
      // Full navigation so the session cookie is picked up on tunnel hosts.
      window.location.assign(safeCallbackPath(searchParams.get("callbackUrl")));
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
      {googleEnabled && (
        <div className="mb-5">
          <GoogleButton label="Sign in with Google" />
        </div>
      )}

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
           
            required
          />
          <div className="text-right">
            <Link href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Forgot your password?
            </Link>
          </div>
        </div>

        {needsCode && (
          <div className="grid gap-2">
            <Label htmlFor="totp" className="text-sm font-medium">
              Code from your authenticator app
            </Label>
            <Input
              id="totp"
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="tracking-widest"
            />
            <p className="text-xs text-muted-foreground">Lost your phone? Type one of your recovery codes instead.</p>
          </div>
        )}

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
          className="mt-1 w-full"
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
