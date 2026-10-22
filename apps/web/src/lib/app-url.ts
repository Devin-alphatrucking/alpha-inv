/**
 * The public address of this app, used to build links in emails. Taken from the server
 * environment on purpose (never from the incoming request), otherwise an attacker could
 * make a password-reset email point at their own website by forging the Host header.
 */
export function appUrl(): string {
  const configured = (process.env.APP_URL || process.env.AUTH_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL (or AUTH_URL) must be set so email links point at the right address.");
  }
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
