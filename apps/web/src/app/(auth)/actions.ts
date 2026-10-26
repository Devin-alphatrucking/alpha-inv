"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/security/rate-limit";
import { signUp } from "@/lib/flows/signup";
import { confirmEmail, confirmEmailWithCode, requestPasswordReset, resendVerification, resetPassword, resetPasswordWithCode } from "@/lib/flows/verify-reset";
import { acceptInvite } from "@/lib/flows/invite";

// Thin wrappers: the pages call these, the real work (and its tests) lives in src/lib/flows.
// None of them needs a signed-in user, except accepting an invitation for an existing account.

async function ip() {
  return clientIp(await headers());
}

export async function signUpAction(input: Record<string, unknown>) {
  return signUp(input, { ip: await ip() });
}

export async function confirmEmailAction(token: string) {
  return confirmEmail(token);
}

export async function confirmEmailCodeAction(email: string, code: string) {
  return confirmEmailWithCode(email, code, { ip: await ip() });
}

export async function resetPasswordCodeAction(input: { email: string; code: string; password: string }) {
  return resetPasswordWithCode(input, { ip: await ip() });
}

export async function resendVerificationAction(email: string) {
  return resendVerification(email, { ip: await ip() });
}

export async function requestResetAction(email: string) {
  return requestPasswordReset(email, { ip: await ip() });
}

export async function resetPasswordAction(input: { token: string; password: string }) {
  return resetPassword(input);
}

export async function acceptInviteAction(input: Record<string, unknown>) {
  const session = await auth();
  return acceptInvite(input, session?.user?.id ?? null);
}
