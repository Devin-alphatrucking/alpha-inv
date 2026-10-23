import type { MetadataRoute } from "next";
import { landingEnabled } from "@/lib/marketing/pricing";

export const dynamic = "force-dynamic";

/** The public pages, with absolute addresses (they need APP_URL). Empty when there is no address or the landing page is off. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL || process.env.AUTH_URL || "").trim().replace(/\/+$/, "");
  if (!base || !landingEnabled(process.env.LANDING_PAGE)) return [];
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
