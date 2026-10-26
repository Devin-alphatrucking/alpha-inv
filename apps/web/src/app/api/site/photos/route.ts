import { NextResponse } from "next/server";
import { hasPermission, requireUser } from "@/lib/permissions";
import { AppError, handleError, newRequestId, isAppError } from "@/lib/errors";
import { uploadSitePhotos } from "@/lib/site/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Adds photos to a project (optionally to one day's report, an issue or a delivery). The person and the company come from the session. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    if (!hasPermission(user.role, "site:write") && !hasPermission(user.role, "delivery:write")) throw new AppError("PERMISSION_001");
    orgId = user.orgId;
    return await uploadSitePhotos(request, user);
  } catch (error) {
    const appError = await handleError({ error, endpoint: "/api/site/photos", method: "POST", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
