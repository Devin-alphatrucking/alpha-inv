import { flow, need, requireMobile, route } from "@/lib/mobile/http";
import { deletePhoto } from "@/lib/flows/site";
import { serveSitePhoto } from "@/lib/site/http";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** The picture itself (company, project and file type are verified). Show it with the sign-in header. */
export const GET = route<Ctx>("/api/v1/site/photos/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  return serveSitePhoto(me, (await ctx.params).id);
});

/** DELETE: the person who added it (before its report is submitted) or a project manager. */
export const DELETE = route<Ctx>("/api/v1/site/photos/[id]", async (req, ctx) => {
  const me = await requireMobile(req);
  return flow(await deletePhoto(me, (await ctx.params).id));
});
