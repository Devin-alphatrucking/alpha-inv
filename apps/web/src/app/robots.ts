import type { MetadataRoute } from "next";
import { landingEnabled } from "@/lib/marketing/pricing";

export const dynamic = "force-dynamic"; // reads APP_URL when asked, not when built

/** Search engines may read the public pages and nothing inside the app. Off entirely when the landing page is turned off. */
export default function robots(): MetadataRoute.Robots {
  if (!landingEnabled(process.env.LANDING_PAGE)) return { rules: { userAgent: "*", disallow: "/" } };
  const base = (process.env.APP_URL || process.env.AUTH_URL || "").trim().replace(/\/+$/, "");
  return {
    rules: { userAgent: "*", allow: ["/", "/pricing", "/signup"], disallow: ["/api/", "/dashboard", "/invoices", "/projects", "/payments", "/admin", "/account", "/plan", "/locked"] },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
