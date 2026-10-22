import { rawDb } from "@/lib/db";
import { SLUG_RE } from "@/lib/brand/brand";
import { detectLogoType } from "@/lib/brand/logo";

type Ctx = { params: Promise<{ slug: string }> };

/** A company's logo. Public on purpose: the sign-in page shows it before anyone is signed in. */
export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return new Response("Not found", { status: 404 });

  const org = await rawDb.organization.findUnique({
    where: { slug },
    select: { logo: { select: { contentType: true, data: true } } },
  });
  const logo = org?.logo;
  if (!logo) return new Response("Not found", { status: 404 });

  // Defence in depth: serve only what really is a PNG/JPEG/WebP.
  const bytes = new Uint8Array(logo.data);
  const type = detectLogoType(bytes);
  if (!type) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // the URL carries ?v=<version>, so it can be cached for a long time
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
