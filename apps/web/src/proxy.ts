import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  ADMIN_ONLY_PREFIXES,
  STAFF_ALLOWED_PREFIXES,
} from "@/lib/nav";

// Brand endpoints are public on purpose: the sign-in screens need the company's
// name, colours and logo before anyone is signed in.
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/api/branding/public",
  "/api/branding/logo",
  "/api/billing/razorpay/webhook",
  "/api/billing/reconcile",
];

const BRAND_COOKIE = "brand-c";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/**
 * `?c=<company slug>` remembers which company's branding to show on the sign-in page.
 * The cookie is also added to the request that is forwarded to the page, so the very
 * first visit already renders that company's branding (not only the second).
 */
function nextWithBrand(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("c")?.trim().toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) return NextResponse.next();

  const headers = new Headers(req.headers);
  const others = (headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${BRAND_COOKIE}=`));
  headers.set("cookie", [...others, `${BRAND_COOKIE}=${slug}`].join("; "));

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(BRAND_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (isPublic) {
    return nextWithBrand(req);
  }

  if (!req.auth) {
    // API callers (fetch, the mobile app) need a machine-readable answer, not the sign-in page.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    const company = nextUrl.searchParams.get("c");
    if (company) loginUrl.searchParams.set("c", company);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth.user.role;

  if (role === "STAFF") {
    const allowed = STAFF_ALLOWED_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
    if (!allowed) {
      return NextResponse.redirect(new URL("/invoices/upload", nextUrl.origin));
    }
    return NextResponse.next();
  }

  // ADMIN: block nothing in the app shell; admin-only prefixes are informational
  // for sidebar. Keep explicit guard if somehow a restricted path is added later.
  const isAdminOnlyPath = ADMIN_ONLY_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
  if (isAdminOnlyPath && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/invoices/upload", nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|favicon-16x16.png|favicon-32x32.png|apple-icon.png|apple-touch-icon.png|manifest.webmanifest|icons/).*)",
  ],
};
