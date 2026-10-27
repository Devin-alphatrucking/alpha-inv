import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { uploadDocument } from "@/lib/site/doc-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Adds a new revision to a drawing (multipart: file, revision, note, issuedOn). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await context.params;
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;
    return await uploadDocument(request, user, id);
  } catch (error) {
    const appError = await handleError({ error, endpoint: `/api/site/documents/${id}`, method: "POST", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
