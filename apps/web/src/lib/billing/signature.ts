import { createHmac, timingSafeEqual } from "node:crypto";

// Razorpay signatures are lowercase-hex HMAC-SHA256. Compared in constant time.
function safeEqualHex(expected: string, given: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(given ?? "").trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook: HMAC-SHA256 of the RAW request body with the webhook secret, sent in the X-Razorpay-Signature header. */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string) {
  if (!secret || !signature) return false;
  return safeEqualHex(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), signature);
}

/** Checkout return: HMAC-SHA256 of "payment_id|subscription_id" with the API key SECRET. */
export function verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string | null | undefined, keySecret: string) {
  if (!keySecret || !paymentId || !subscriptionId || !signature) return false;
  return safeEqualHex(createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`, "utf8").digest("hex"), signature);
}

/** Used by tests and the fake Razorpay server. */
export function signWebhook(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}
