"use server";

import { requireUser } from "@/lib/permissions";
import { sendStepUpCode, STEP_UP_ACTIONS } from "@/lib/security/step-up";

/** Emails the signed-in person a code to confirm a risky action. Only the actions we list can be named (the name goes into the email). */
export async function sendStepUpCodeAction(action: string) {
  const user = await requireUser({ allowLocked: true });
  if (!(STEP_UP_ACTIONS as readonly string[]).includes(action)) return { ok: false as const, error: "Unknown action." };
  return sendStepUpCode(user.id, action);
}
