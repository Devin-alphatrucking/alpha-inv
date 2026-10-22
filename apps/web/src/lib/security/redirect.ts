/**
 * Only a path inside this app. Anything else (another site, "//host", "/\host", "javascript:", control characters)
 * becomes "/", so a crafted sign-in link cannot send the person somewhere else after they sign in.
 */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 2000) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  return raw;
}
