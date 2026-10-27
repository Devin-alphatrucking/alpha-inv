import { NextResponse } from "next/server";
import { addPhotos, photoFile, type SiteUser } from "@/lib/flows/site";
import { readPhoto } from "@/lib/site/storage";
import { PHOTO_MAX_BYTES, PHOTOS_PER_UPLOAD } from "@/lib/site/rules";

/** The two photo endpoints are shared by the website (cookie sign-in) and the phone (bearer sign-in): each finds the person its own way, then both do exactly this. */

/** Reads a multipart upload (file, projectId, reportId / issueId / receiptId, area, caption) and adds the photos. */
export async function uploadSitePhotos(request: Request, user: SiteUser): Promise<NextResponse> {
  // A browser sends Origin on every cross-site POST; refuse one that is not from this site. (The phone sends none.)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > (PHOTO_MAX_BYTES + 1024 * 1024) * PHOTOS_PER_UPLOAD) return NextResponse.json({ error: "That is too much to send at once." }, { status: 413 });

  const form = await request.formData();
  const text = (key: string) => (typeof form.get(key) === "string" ? (form.get(key) as string).trim() : "");
  const files: { name: string; bytes: Buffer }[] = [];
  for (const entry of form.getAll("file")) {
    if (!(entry instanceof File)) continue;
    // A file over the limit is passed on empty so the same check reports it with the same words.
    files.push({ name: entry.name, bytes: entry.size > PHOTO_MAX_BYTES ? Buffer.alloc(0) : Buffer.from(await entry.arrayBuffer()) });
  }
  const result = await addPhotos(user, {
    projectId: text("projectId"),
    reportId: text("reportId") || null,
    issueId: text("issueId") || null,
    receiptId: text("receiptId") || null,
    clientRef: text("clientRef") || null,
    area: text("area"),
    caption: text("caption"),
    files,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}

/** The picture itself, only if this person may see its project. */
export async function serveSitePhoto(user: SiteUser, id: string): Promise<NextResponse> {
  const photo = await photoFile(user, id);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readPhoto(photo.fileUrl);
  if (!bytes) return NextResponse.json({ error: "File missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      // The type saved when the photo was checked, never one taken from the file name.
      "Content-Type": photo.contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
