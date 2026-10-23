"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/permissions";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes } from "@/lib/flows/two-factor";

// Works on the SIGNED-IN person only (id from the session). Secrets and recovery codes are shown once and never stored in readable form.

export async function beginTwoFactorAction() {
  const user = await requireUser({ allowLocked: true });
  const r = await beginTwoFactorSetup(user.id);
  if (!r.ok) return r;
  // The picture is drawn here on the server from the app link; the secret never goes to a third-party QR service.
  const qrSvg = await QRCode.toString(r.uri, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" });
  return { ok: true as const, secret: r.secret, qrSvg };
}

export async function confirmTwoFactorAction(code: string) {
  const user = await requireUser({ allowLocked: true });
  const r = await confirmTwoFactorSetup(user.id, String(code ?? ""));
  if (r.ok) revalidatePath("/account");
  return r;
}

export async function disableTwoFactorAction(password: string, code: string) {
  const user = await requireUser({ allowLocked: true });
  const r = await disableTwoFactor(user.id, String(password ?? ""), String(code ?? ""));
  if (r.ok) revalidatePath("/account");
  return r;
}

export async function regenerateRecoveryCodesAction(password: string, code: string) {
  const user = await requireUser({ allowLocked: true });
  const r = await regenerateRecoveryCodes(user.id, String(password ?? ""), String(code ?? ""));
  if (r.ok) revalidatePath("/account");
  return r;
}
