import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { uploadDocument } from "@/lib/site/doc-http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Adds a new drawing or document (multipart: file, projectId, title, number, category, description, revision, note, issuedOn). The flow checks the role. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;
    return await uploadDocument(request, user);
  } catch (error) {
    const appError = await handleError({ error, endpoint: "/api/site/documents", method: "POST", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
