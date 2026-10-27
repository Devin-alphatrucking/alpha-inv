import { NextResponse } from "next/server";
import { jobsAllowed } from "@/lib/jobs-auth";
import { sendTrialNotices } from "@/lib/flows/trial-notices";

// Called by a scheduler (for example once an hour), not by a person: protected by JOBS_SECRET. Safe to call as often as you
// like: each notice is claimed before it is sent, so every company gets each notice once per trial.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!jobsAllowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendTrialNotices()) });
  } catch (error) {
    console.error("[trial notices job]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "The trial notice run failed." }, { status: 500 });
  }
}
