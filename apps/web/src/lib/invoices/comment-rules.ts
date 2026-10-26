import type { RoleName } from "@/lib/roles";
// Rules for invoice comments. Pure functions, unit-tested (comment-rules.test.ts).

export const COMMENT_MAX = 2000;

// Control characters (they can break displays and logs) and invisible direction marks (they can disguise text).
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Tidies what was typed: line endings made uniform, unsafe characters removed, trailing spaces dropped, runs of blank lines
 * squeezed to one, and the ends trimmed. Returns the text, or an error to show.
 */
export function cleanComment(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write something first." };
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body === "") return { ok: false, error: "Write something first." };
  if ([...body].length > COMMENT_MAX) return { ok: false, error: `Keep a comment under ${COMMENT_MAX} characters.` };
  return { ok: true, body };
}

/** The author, or an administrator, may remove a comment. */
export function canDeleteComment(user: { id: string; role: RoleName }, comment: { userId: string | null }): boolean {
  return user.role === "ADMIN" || (comment.userId !== null && comment.userId === user.id);
}
