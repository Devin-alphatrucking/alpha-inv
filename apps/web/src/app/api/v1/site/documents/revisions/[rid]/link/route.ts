import { json, need, notFound, requireMobile, route } from "@/lib/mobile/http";
import { revisionFile } from "@/lib/flows/documents";
import { DOC_LINK_SECONDS, signDocLink } from "@/lib/site/doc-links";
import { absoluteUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST: a five-minute address for opening this revision's file in the phone's browser (the browser cannot send the app's sign-in header).
 * The person's access to the project is checked now and again when the address is used.
 */
export const POST = route<{ params: Promise<{ rid: string }> }>("/api/v1/site/documents/revisions/[rid]/link", async (req, ctx) => {
  const me = await requireMobile(req);
  need(me, "site:view");
  const { rid } = await ctx.params;
  if (!(await revisionFile(me, rid))) return notFound("Drawing");
  const token = signDocLink({ revisionId: rid, userId: me.id, orgId: me.orgId });
  // The address comes from the server settings, never from the request, so a forged Host header cannot point it elsewhere.
  return json({ url: absoluteUrl(`/api/site/documents/dl?token=${encodeURIComponent(token)}`), expiresInSeconds: DOC_LINK_SECONDS });
});
