import { NextResponse } from "next/server";
import { jobsAllowed } from "@/lib/jobs-auth";
import { sendQuietNotices } from "@/lib/flows/quiet-notices";

// Called by a scheduler (for example once an hour), not by a person: protected by JOBS_SECRET. Safe to call as often as you
// like: the notice is claimed before it is sent, so a quiet company is written to at most once a month.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!jobsAllowed(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendQuietNotices()) });
  } catch (error) {
    console.error("[quiet notices job]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "The quiet notice run failed." }, { status: 500 });
  }
}
