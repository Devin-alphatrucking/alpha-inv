import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { canOpenPath, homeFor, isRole } from "@/lib/roles";
import { masterGate } from "@/lib/master/gate";

// Brand endpoints are public on purpose: the sign-in screens need the company's
// name, colours and logo before anyone is signed in.
const PUBLIC_PATHS = [
  "/pricing",
  "/robots.txt",
  "/sitemap.xml",
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/operator-login",
  "/api/branding/public",
  "/api/branding/logo",
  "/api/billing/razorpay/webhook",
  "/api/billing/reconcile",
  "/api/jobs/digest",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
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
  // "/" is the public landing page (it sends signed-in people to their dashboard); every other public page is listed above.
  // With MASTER_HOST set the master console lives on its own address and everything else is a 404 there (see lib/master/gate.ts).
  const gate = masterGate({ masterHost: process.env.MASTER_HOST, host: req.headers.get("host"), pathname, signedIn: Boolean(req.auth) });
  if (gate.action === "not_found") return NextResponse.rewrite(new URL("/__not_found__", nextUrl.origin));
  if (gate.action === "redirect") return NextResponse.redirect(new URL(gate.to, nextUrl.origin));

  const isPublic = pathname === "/" || PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (isPublic) {
    return nextWithBrand(req);
  }

  // The mobile apps authenticate with a bearer token, which the route handlers verify themselves
  // (requireUser): let those API calls through to them instead of asking for a cookie.
  if (pathname.startsWith("/api/") && /^Bearer\s/i.test(req.headers.get("authorization") ?? "")) {
    return NextResponse.next();
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

  // What each role may open comes from one table (lib/roles.ts). Anyone who tries something else is sent to a place they can work.
  const role = isRole(req.auth.user.role) ? req.auth.user.role : null;
  // A session with a role we do not know (an old or damaged token) must sign in again, not bounce between pages.
  if (!role) return NextResponse.redirect(new URL("/login", nextUrl.origin));
  if (!canOpenPath(role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(role), nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|favicon-16x16.png|favicon-32x32.png|apple-icon.png|apple-touch-icon.png|manifest.webmanifest|icons/).*)",
  ],
};
