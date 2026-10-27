import { NextResponse } from "next/server";
import { serveRevision, userFromDocLink } from "@/lib/site/doc-http";

export const runtime = "nodejs";

/**
 * Opens a drawing from the phone's browser using the short-lived address the app asked for (see /api/v1/site/documents/revisions/<id>/link).
 * It works for that one file for five minutes, and the person's access is checked again here. Nothing else about the person is shown.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const who = await userFromDocLink(token);
  if (!who) return NextResponse.json({ error: "This link has expired. Open the drawing again from the app." }, { status: 410 });
  const res = await serveRevision(who.user, who.revisionId);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
