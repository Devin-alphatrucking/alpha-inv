import { createHash } from "node:crypto";
import { Prisma } from "@alpha/db";
import { rawDb } from "@/lib/db";
import { razorpayConfig } from "./razorpay";
import { verifyWebhookSignature } from "./signature";
import { applySubscriptionUpdate, type ProviderPayment } from "./service";
import type { ProviderSubscription } from "./rules";

export type WebhookReply = { status: number; body: { ok: boolean; message: string } };
const reply = (status: number, message: string): WebhookReply => ({ status, body: { ok: status < 300, message } });

type Payload = {
  event?: string;
  created_at?: number;
  payload?: { subscription?: { entity?: ProviderSubscription }; payment?: { entity?: ProviderPayment & Record<string, unknown> } };
};

/**
 * Razorpay webhook. Order of work: verify the signature on the RAW body, record the event (its id is unique, so a
 * repeated delivery is recognised), apply it, mark the outcome. A 5xx makes Razorpay retry later; everything here is safe to repeat.
 */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null): Promise<WebhookReply> {
  const cfg = razorpayConfig();
  if (!cfg || !cfg.webhookSecret) return reply(503, "Webhook is not configured.");
  if (!verifyWebhookSignature(rawBody, signature, cfg.webhookSecret)) return reply(400, "Invalid signature.");

  let data: Payload;
  try {
    data = JSON.parse(rawBody) as Payload;
  } catch {
    return reply(400, "Invalid body.");
  }
  const type = typeof data.event === "string" ? data.event.slice(0, 100) : "";
  if (!type) return reply(400, "Missing event.");
  const eventId = (eventIdHeader?.trim() || createHash("sha256").update(rawBody).digest("hex")).slice(0, 200);

  const sub = data.payload?.subscription?.entity;
  const pay = data.payload?.payment?.entity;
  // Keep what we need, not the customer's contact details.
  const stored = {
    event: type,
    created_at: data.created_at ?? null,
    subscription: sub ?? null,
    payment: pay ? { id: pay.id, amount: pay.amount, currency: pay.currency, status: pay.status, method: pay.method, created_at: pay.created_at } : null,
  };

  try {
    await rawDb.billingEvent.create({ data: { eventId, type, payload: stored as Prisma.InputJsonValue } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const seen = await rawDb.billingEvent.findUnique({ where: { eventId }, select: { outcome: true } });
      if (seen?.outcome === "processed" || seen?.outcome === "ignored") return reply(200, "Already received.");
      // Received before but never finished: process it again below.
    } else {
      throw error;
    }
  }

  try {
    let outcome: "processed" | "ignored" = "ignored";
    let orgId: string | undefined;
    if (type.startsWith("subscription.") && sub?.id) {
      const eventAt = typeof data.created_at === "number" && data.created_at > 0 ? new Date(data.created_at * 1000) : new Date();
      const result = await applySubscriptionUpdate(sub, eventAt, { payment: pay });
      orgId = result.orgId;
      outcome = result.outcome === "applied" ? "processed" : "ignored";
    }
    await rawDb.billingEvent.update({ where: { eventId }, data: { outcome, organizationId: orgId ?? null, processedAt: new Date(), error: null } });
    return reply(200, outcome === "processed" ? "Processed." : "Ignored.");
  } catch (error) {
    console.error("[razorpay webhook]", type, error instanceof Error ? error.message : error);
    await rawDb.billingEvent
      .update({ where: { eventId }, data: { outcome: "error", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) } })
      .catch(() => undefined);
    return reply(500, "Could not process; will retry.");
  }
}
