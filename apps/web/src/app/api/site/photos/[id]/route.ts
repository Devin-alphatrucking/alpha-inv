import { NextResponse } from "next/server";
import { requireUser } from "@/lib/permissions";
import { handleError, newRequestId, isAppError } from "@/lib/errors";
import { hasPermission } from "@/lib/roles";
import { serveSitePhoto } from "@/lib/site/http";

export const runtime = "nodejs";

// Photos are served through here (never by a public storage link): the person must belong to the company and be able to see the project.
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await context.params;
  let orgId: string | undefined;
  try {
    const user = await requireUser();
    orgId = user.orgId;
    if (!hasPermission(user.role, "site:view")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return await serveSitePhoto(user, id);
  } catch (error) {
    const appError = await handleError({ error, endpoint: `/api/site/photos/${id}`, method: "GET", requestId, organizationId: orgId });
    return NextResponse.json({ error: appError.message, code: appError.code, requestId }, { status: isAppError(error) ? appError.status : 500 });
  }
}
