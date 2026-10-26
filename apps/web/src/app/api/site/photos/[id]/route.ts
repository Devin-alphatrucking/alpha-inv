import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { photoFile } from "@/lib/flows/site";
import { readPhoto } from "@/lib/site/storage";

export const runtime = "nodejs";

// Photos are served through here (never by a public storage link): the person must belong to the company and be able to see the project.
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await context.params;
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;
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
  } catch (error) {
    const appError = await handleError({ error, endpoint: `/api/site/photos/${id}`, method: "GET", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
