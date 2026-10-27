import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived address for opening one drawing file from the phone's browser, which cannot send the app's sign-in header.
 * The address carries who asked, which file and when it stops working. It is only valid for that file, for five minutes, and the
 * person's access to the project is checked again when it is used.
 */
export const DOC_LINK_SECONDS = 300;

const secret = () => process.env.MOBILE_TOKEN_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";

const sign = (payload: string) => createHmac("sha256", secret()).update(`doc-link-v1.${payload}`).digest("base64url");

export function signDocLink(input: { revisionId: string; userId: string; orgId: string }, now: Date = new Date()): string {
  if (!secret()) throw new Error("AUTH_SECRET is not set.");
  const payload = Buffer.from(JSON.stringify({ r: input.revisionId, u: input.userId, o: input.orgId, e: Math.floor(now.getTime() / 1000) + DOC_LINK_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyDocLink(token: string, now: Date = new Date()): { revisionId: string; userId: string; orgId: string } | null {
  try {
    if (!secret() || typeof token !== "string" || token.length > 600) return null;
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    const want = Buffer.from(sign(payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { r?: unknown; u?: unknown; o?: unknown; e?: unknown };
    if (typeof data.r !== "string" || typeof data.u !== "string" || typeof data.o !== "string" || typeof data.e !== "number") return null;
    if (data.e * 1000 <= now.getTime()) return null;
    return { revisionId: data.r, userId: data.u, orgId: data.o };
  } catch {
    return null;
  }
}
