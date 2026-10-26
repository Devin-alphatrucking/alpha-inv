import { AppError } from "@/lib/errors";
import { json, need, requireMobile, route } from "@/lib/mobile/http";
import { hasPermission } from "@/lib/roles";
import { listPhotos } from "@/lib/flows/site";
import { uploadSitePhotos } from "@/lib/site/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET ?projectId= | reportId= | issueId= | receiptId=: photo details (open each one with GET /api/v1/site/photos/<id>). */
export const GET = route("/api/v1/site/photos", async (req) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const sp = new URL(req.url).searchParams;
  const opt = (k: string) => sp.get(k) || undefined;
  return json({ photos: await listPhotos(me, { projectId: sp.get("projectId"), reportId: opt("reportId"), issueId: opt("issueId"), receiptId: opt("receiptId"), take: 120 }) });
});

/** POST multipart (file, projectId, reportId / issueId / receiptId, area, caption): adds up to 10 photos. Same checks as the website. */
export const POST = route("/api/v1/site/photos", async (req) => {
  const me = await requireMobile(req);
  if (!hasPermission(me.role, "site:write") && !hasPermission(me.role, "delivery:write")) throw new AppError("PERMISSION_001");
  return uploadSitePhotos(req, me);
});
