import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBrand } from "@/lib/brand/brand";

/** The signed-in user's company brand, for the web and mobile apps to theme themselves at run time. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const brand = await getBrand();
  return NextResponse.json(
    { brand },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
