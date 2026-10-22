// Turns a company's brand colours into CSS variables. Pure and strictly validated:
// only "#RRGGBB" values are ever accepted, so nothing user-supplied can reach the page as markup.

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR.test(v);
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex([r, g, b]: [number, number, number]) {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on this colour. */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#111111") ? "#ffffff" : "#111111";
}

function mixWithWhite(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  return toHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

/** In dark mode a very dark brand colour would vanish into the background: lighten it. */
export function forDarkMode(hex: string): string {
  return contrastRatio(hex, "#0a0a0a") < 3 ? mixWithWhite(hex, 0.4) : hex;
}

/** CSS that overrides the app's theme variables. Empty string when no colours are set. */
export function brandCss(colors: { primary?: string | null; accent?: string | null }): string {
  const rules: string[] = [];
  const light: string[] = [];
  const dark: string[] = [];
  if (isHexColor(colors.primary)) {
    const p = colors.primary;
    const d = forDarkMode(p);
    light.push(
      `--primary:${p}`,
      `--primary-foreground:${readableOn(p)}`,
      `--ring:${p}`,
      `--sidebar-primary:${p}`,
      `--sidebar-primary-foreground:${readableOn(p)}`,
      `--chart-1:${p}`
    );
    dark.push(
      `--primary:${d}`,
      `--primary-foreground:${readableOn(d)}`,
      `--ring:${d}`,
      `--sidebar-primary:${d}`,
      `--sidebar-primary-foreground:${readableOn(d)}`,
      `--chart-1:${d}`
    );
  }
  if (isHexColor(colors.accent)) {
    const a = colors.accent;
    light.push(`--brand-accent:${a}`, `--chart-2:${a}`);
    dark.push(`--brand-accent:${forDarkMode(a)}`, `--chart-2:${forDarkMode(a)}`);
  }
  if (light.length) rules.push(`:root{${light.join(";")}}`);
  if (dark.length) rules.push(`.dark{${dark.join(";")}}`);
  return rules.join("");
}
