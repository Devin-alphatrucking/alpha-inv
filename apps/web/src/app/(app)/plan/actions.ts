"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/permissions";
import { isAppError } from "@/lib/errors";
import { cancelPurchase, confirmCheckout, startPurchase, type CheckoutStart } from "@/lib/billing/service";

// Only a company administrator can buy or cancel. The company and the person come from the signed session, never from the browser.
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (isAppError(error)) return { ok: false, error: error.message };
  console.error("[billing action]", error instanceof Error ? error.message : error);
  return { ok: false, error: "Something went wrong. Please try again or contact support." };
}

export async function startCheckoutAction(): Promise<Result<{ checkout: CheckoutStart & { name: string; email: string } }>> {
  try {
    const user = await requireAdmin();
    const checkout = await startPurchase(user);
    return { ok: true, checkout: { ...checkout, name: user.name ?? "", email: user.email ?? "" } };
  } catch (error) {
    return fail(error);
  }
}

export async function confirmCheckoutAction(input: { paymentId: string; subscriptionId: string; signature: string }): Promise<Result<{ status: string }>> {
  try {
    const user = await requireAdmin();
    const r = await confirmCheckout(user, {
      paymentId: String(input.paymentId ?? ""),
      subscriptionId: String(input.subscriptionId ?? ""),
      signature: String(input.signature ?? ""),
    });
    revalidatePath("/plan");
    return { ok: true, status: r.status };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelPurchaseAction(purchaseId: string): Promise<Result<{ atCycleEnd: boolean }>> {
  try {
    const user = await requireAdmin();
    const r = await cancelPurchase(user, String(purchaseId ?? ""));
    revalidatePath("/plan");
    return { ok: true, atCycleEnd: r.atCycleEnd };
  } catch (error) {
    return fail(error);
  }
}
