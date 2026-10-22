import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reconcile } from "@/lib/billing/service";
import { AppError } from "@/lib/errors";

// Safety net for a missed webhook: re-reads every unfinished purchase from Razorpay. Meant for a scheduler (for example once a day),
// protected by BILLING_CRON_SECRET sent as "Authorization: Bearer <secret>". With no secret configured it is switched off.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function allowed(req: Request) {
  const secret = process.env.BILLING_CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), "utf8");
  const want = Buffer.from(secret, "utf8");
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!allowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await reconcile()) });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Reconcile failed.";
    console.error("[billing reconcile]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
