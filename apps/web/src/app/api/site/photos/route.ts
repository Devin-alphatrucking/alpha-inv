import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { addPhotos } from "@/lib/flows/site";
import { PHOTO_MAX_BYTES, PHOTOS_PER_UPLOAD } from "@/lib/site/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Adds photos to a project (optionally to one day's report or one issue). The person and the company come from the session. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  let orgId: string | undefined;
  try {
    // A browser sends Origin on every cross-site POST; refuse one that is not from this site.
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    }
    const user = await requirePermission("site:write");
    orgId = user.orgId;
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > (PHOTO_MAX_BYTES + 1024 * 1024) * PHOTOS_PER_UPLOAD) return NextResponse.json({ error: "That is too much to send at once." }, { status: 413 });

    const form = await request.formData();
    const text = (key: string) => (typeof form.get(key) === "string" ? (form.get(key) as string).trim() : "");
    const files: { name: string; bytes: Buffer }[] = [];
    for (const entry of form.getAll("file")) {
      if (!(entry instanceof File)) continue;
      if (entry.size > PHOTO_MAX_BYTES) {
        files.push({ name: entry.name, bytes: Buffer.alloc(0) }); // reported as "empty"/too big by the same check as everything else
        continue;
      }
      files.push({ name: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) });
    }

    const result = await addPhotos(user, {
      projectId: text("projectId"),
      reportId: text("reportId") || null,
      issueId: text("issueId") || null,
      area: text("area"),
      caption: text("caption"),
      files,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    const appError = await handleError({ error, endpoint: "/api/site/photos", method: "POST", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
