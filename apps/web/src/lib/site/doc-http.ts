import { NextResponse } from "next/server";
import { rawDb } from "@/lib/db";
import { addRevision, createDocument, readRevision, revisionFile, type DocUser } from "@/lib/flows/documents";
import { DOCUMENT_MAX_BYTES, formatOf, servingHeaders } from "@/lib/site/document-rules";
import { verifyDocLink } from "@/lib/site/doc-links";
import { isOrgAllowedToSignIn } from "@/lib/org/default-membership";
import type { RoleName } from "@/lib/roles";

/** Shared by the website (cookie sign-in) and the phone: each finds the person its own way, then both do exactly this. */

/** Reads a multipart upload (file + details) and adds a new drawing, or a new revision of `documentId`. */
export async function uploadDocument(request: Request, user: DocUser, documentId?: string): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > DOCUMENT_MAX_BYTES + 1024 * 1024) return NextResponse.json({ ok: false, error: "That file is too large." }, { status: 413 });

  const form = await request.formData();
  const text = (key: string) => (typeof form.get(key) === "string" ? (form.get(key) as string) : "");
  const entry = form.get("file");
  const file = entry instanceof File ? { name: entry.name, bytes: entry.size > DOCUMENT_MAX_BYTES ? Buffer.alloc(0) : Buffer.from(await entry.arrayBuffer()) } : null;
  const data = { title: text("title"), number: text("number"), category: text("category"), description: text("description"), revision: text("revision"), note: text("note"), issuedOn: text("issuedOn") };
  const result = documentId ? await addRevision(user, documentId, { data, file }) : await createDocument(user, { projectId: text("projectId").trim(), data, file });
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}

/** The file itself, only if this person may see its project. Drawings open in the page when that is safe, others download. */
export async function serveRevision(user: DocUser, revisionId: string): Promise<NextResponse> {
  const rev = await revisionFile(user, revisionId);
  if (!rev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const format = formatOf(rev.contentType);
  const bytes = await readRevision(rev.fileUrl);
  if (!format || !bytes) return NextResponse.json({ error: "File missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: servingHeaders(format, rev.fileName) });
}

/** The person behind a phone download link, if they still belong to a company that may be entered. */
export async function userFromDocLink(token: string): Promise<{ user: DocUser; revisionId: string } | null> {
  const link = verifyDocLink(token);
  if (!link) return null;
  const [u, m] = await Promise.all([
    rawDb.user.findUnique({ where: { id: link.userId }, select: { deletedAt: true, emailVerifiedAt: true } }),
    rawDb.membership.findUnique({ where: { userId_organizationId: { userId: link.userId, organizationId: link.orgId } }, select: { role: true, organization: { select: { status: true } } } }),
  ]);
  if (!u || u.deletedAt || !u.emailVerifiedAt || !m || !isOrgAllowedToSignIn(m.organization.status)) return null;
  return { user: { id: link.userId, role: m.role as RoleName, orgId: link.orgId }, revisionId: link.revisionId };
}
