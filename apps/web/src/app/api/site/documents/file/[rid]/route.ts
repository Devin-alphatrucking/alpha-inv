import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { serveRevision } from "@/lib/site/doc-http";

export const runtime = "nodejs";

/** One revision's file for a signed-in person (website). Never a public link: company and project are checked. */
export async function GET(_req: Request, context: { params: Promise<{ rid: string }> }) {
  const requestId = newRequestId();
  const { rid } = await context.params;
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;
    return await serveRevision(user, rid);
  } catch (error) {
    const appError = await handleError({ error, endpoint: `/api/site/documents/file/${rid}`, method: "GET", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
