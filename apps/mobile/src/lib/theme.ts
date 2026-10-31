import { useMemo } from "react";
import { useSession } from "./session";

export type Theme = {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  danger: string;
  warn: string;
  ok: string;
  /** The soft grey of secondary buttons, badges and avatars (the website's "secondary"/"muted" surface). */
  soft: string;
  /** Pale fills behind status badges. */
  okBg: string;
  warnBg: string;
  dangerBg: string;
};

/** Corner radii, the same steps as the website (cards and buttons 14, small things 8). */
export const radius = { sm: 8, md: 12, lg: 14, pill: 999 } as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Perceived brightness: decides whether text on the company's colour should be white or dark. */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#0f172a" : "#ffffff";
}

// The website's colours (neutral greys on white), so the app and the website look like one product.
export const baseTheme: Theme = {
  bg: "#fafafa", // the page behind the cards
  card: "#ffffff",
  text: "#0a0a0a",
  muted: "#737373",
  border: "#e5e5e5",
  primary: "#171717",
  onPrimary: "#fafafa",
  danger: "#e7000b",
  warn: "#b45309",
  ok: "#047857",
  soft: "#f5f5f5",
  okBg: "#ecfdf5",
  warnBg: "#fffbeb",
  dangerBg: "#fef2f2",
};

/** The look of the signed-in company: its brand colour on buttons and accents. */
export function useTheme(): Theme {
  const brand = useSession().me?.company.brand;
  return useMemo(() => {
    const primary = brand?.primaryColor && HEX.test(brand.primaryColor) ? brand.primaryColor : baseTheme.primary;
    return { ...baseTheme, primary, onPrimary: onColor(primary) };
  }, [brand?.primaryColor]);
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
