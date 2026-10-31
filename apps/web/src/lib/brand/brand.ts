import { cache } from "react";
import { auth } from "@/lib/auth";
import { rawDb } from "@/lib/db";
import { DEFAULT_FORMAT, formatFromOrg, makeFormatters, type OrgFormat } from "@/lib/brand/format";
import { isHexColor } from "@/lib/brand/theme";
import { PRODUCT_NAME } from "@/lib/brand/product";

/**
 * Who the app looks like. Signed in: the user's company. Signed out: always the product's own
 * name and logo, so a shared computer never shows the last company. Mobile/web clients read the
 * same data from /api/branding.
 */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export type Brand = {
  /** Company id (null for the neutral default brand). Never sent to signed-out visitors. */
  orgId: string | null;
  slug: string | null;
  name: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  format: OrgFormat;
  isDefault: boolean;
};

export { PRODUCT_NAME };

export const DEFAULT_BRAND: Brand = {
  orgId: null,
  slug: null,
  name: PRODUCT_NAME,
  shortName: PRODUCT_NAME,
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  supportEmail: null,
  supportUrl: null,
  format: DEFAULT_FORMAT,
  isDefault: true,
};

const SELECT = {
  id: true,
  name: true,
  slug: true,
  country: true,
  currency: true,
  timezone: true,
  displayName: true,
  logoUrl: true,
  primaryColor: true,
  accentColor: true,
  supportEmail: true,
  supportUrl: true,
} as const;

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
};

function safeHttpsUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function brandFromOrg(org: OrgRow): Brand {
  const name = org.displayName?.trim() || org.name;
  return {
    orgId: org.id,
    slug: org.slug,
    name,
    shortName: name.length > 18 ? name.slice(0, 18).trim() : name,
    logoUrl: org.logoUrl && org.logoUrl.startsWith("/api/branding/logo/") ? org.logoUrl : null,
    primaryColor: isHexColor(org.primaryColor) ? org.primaryColor : null,
    accentColor: isHexColor(org.accentColor) ? org.accentColor : null,
    supportEmail: org.supportEmail,
    supportUrl: safeHttpsUrl(org.supportUrl),
    format: formatFromOrg(org),
    isDefault: false,
  };
}

export async function loadBrandById(orgId: string): Promise<Brand | null> {
  const org = await rawDb.organization.findUnique({ where: { id: orgId }, select: SELECT });
  return org ? brandFromOrg(org) : null;
}

export async function loadBrandBySlug(slug: string): Promise<Brand | null> {
  if (!SLUG_RE.test(slug)) return null;
  const org = await rawDb.organization.findUnique({ where: { slug }, select: SELECT });
  return org ? brandFromOrg(org) : null;
}

/** What is safe to show to anyone (sign-in page, public endpoint): no company id. */
export function publicBrand(b: Brand): Omit<Brand, "orgId"> {
  const { orgId: _orgId, ...rest } = b;
  void _orgId;
  return rest;
}

/** The brand for the current request. Memoised per request. */
export const getBrand = cache(async (): Promise<Brand> => {
  const session = await auth();
  if (session?.user?.orgId) {
    const own = await loadBrandById(session.user.orgId);
    if (own) return own;
  }
  return DEFAULT_BRAND;
});

/** Formatters (money, dates) for the current company. */
export const getFormat = cache(async () => makeFormatters((await getBrand()).format));
