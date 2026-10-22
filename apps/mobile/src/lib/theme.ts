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
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Perceived brightness: decides whether text on the company's colour should be white or dark. */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#0f172a" : "#ffffff";
}

export const baseTheme: Theme = {
  bg: "#f6f7f9",
  card: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  primary: "#0f172a",
  onPrimary: "#ffffff",
  danger: "#dc2626",
  warn: "#b45309",
  ok: "#047857",
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
