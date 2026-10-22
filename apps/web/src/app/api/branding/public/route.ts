import { NextResponse } from "next/server";
import { DEFAULT_BRAND, loadBrandBySlug, publicBrand } from "@/lib/brand/brand";

/**
 * Public brand for a company code, e.g. /api/branding/public?c=acme. Used by the sign-in
 * screens (web and mobile) before anyone is signed in. Contains no company id and no private data.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("c")?.trim().toLowerCase() ?? "";
  const brand = (slug ? await loadBrandBySlug(slug) : null) ?? DEFAULT_BRAND;
  return NextResponse.json(
    { brand: publicBrand(brand), found: !brand.isDefault },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
