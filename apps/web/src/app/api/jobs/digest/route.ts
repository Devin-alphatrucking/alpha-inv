import { NextResponse } from "next/server";
import { jobsAllowed } from "@/lib/jobs-auth";
import { sendDailyDigests } from "@/lib/flows/digest";

// Called by a scheduler (for example once an hour), not by a person: protected by JOBS_SECRET sent as "Authorization: Bearer <secret>".
// With no secret configured it is switched off. Safe to call as often as you like: each company gets one email a day.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!jobsAllowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendDailyDigests()) });
  } catch (error) {
    console.error("[digest job]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "The digest run failed." }, { status: 500 });
  }
}
