import { AppError } from "@/lib/errors";
import type { ProviderSubscription } from "./rules";

// Thin Razorpay REST client (fetch + Basic auth). Server-only: the key secret never leaves the server.
// RAZORPAY_BASE_URL exists so tests can point it at a fake server.

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string; baseUrl: string };

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
    baseUrl: (process.env.RAZORPAY_BASE_URL?.trim() || "https://api.razorpay.com/v1").replace(/\/+$/, ""),
  };
}

export const billingEnabled = () => razorpayConfig() !== null;

function need(): RazorpayConfig {
  const c = razorpayConfig();
  if (!c) throw new AppError("PAYMENT_001", "Online payments are not set up yet. Contact support to add a project plan.");
  return c;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = need();
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new AppError("PAYMENT_001", "The payment service could not be reached. Please try again in a minute.");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const description = (json as { error?: { description?: string } } | null)?.error?.description;
    // Log the provider's wording for operators; show the customer a neutral message.
    console.error(`[razorpay] ${method} ${path} -> ${res.status} ${description ?? text.slice(0, 200)}`);
    throw new AppError("PAYMENT_001", "The payment service refused the request. Please try again or contact support.", { status: res.status, description });
  }
  return json as T;
}

export type RazorpayPlan = { id: string; interval: number; period: string; item: { amount: number; currency: string; name: string } };

export function createPlan(input: { name: string; amountMinor: number; currency: string; interval: "MONTH" | "YEAR" }) {
  return call<RazorpayPlan>("POST", "/plans", {
    period: input.interval === "YEAR" ? "yearly" : "monthly",
    interval: 1,
    item: { name: input.name, amount: input.amountMinor, currency: input.currency },
  });
}

export function createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
  return call<ProviderSubscription>("POST", "/subscriptions", {
    plan_id: input.planId,
    total_count: input.totalCount,
    quantity: 1,
    customer_notify: 1,
    notes: input.notes,
  });
}

export const fetchSubscription = (id: string) => call<ProviderSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);

/** `atCycleEnd`: keep it running until the paid period is over (only possible once it is active). */
export const cancelSubscription = (id: string, atCycleEnd: boolean) =>
  call<ProviderSubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
