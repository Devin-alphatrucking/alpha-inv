import { NextResponse } from "next/server";
import { handleRazorpayWebhook } from "@/lib/billing/webhook";

// Called by Razorpay, not by a signed-in person: protected by the signature on the raw body instead of a session.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false, message: "Too large." }, { status: 413 });
  const result = await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
  return NextResponse.json(result.body, { status: result.status });
}
