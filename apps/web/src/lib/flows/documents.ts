import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/roles";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { removePhotos, storeDocument } from "@/lib/site/storage";
import { readPhoto } from "@/lib/site/storage";
import { CATEGORIES, formatOf, parseDocument, type DocCategory } from "@/lib/site/document-rules";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * Drawings and documents of a project, kept as revisions. Anyone with site access to the project can read them; issuing a drawing or a
 * new revision is for administrators and project managers (so the file site works from is the one the office meant).
 * Someone who cannot see a project cannot tell its drawings exist.
 */

export type DocUser = ProjectUser;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const can = (u: DocUser, p: Parameters<typeof hasPermission>[1]) => hasPermission(u.role, p);

async function visibleProject(user: DocUser, projectId: string) {
  if (!can(user, "site:view")) return null;
  return dbFor(user.orgId).project.findFirst({ where: { id: projectId, ...projectAccessWhere(user) }, select: { id: true, name: true, status: true } });
}

async function today(orgId: string) {
  return todayIn(await companyTimeZone(orgId));
}

export type RevisionView = {
  id: string; revision: string; note: string | null; issuedOn: string; fileName: string; contentType: string; formatLabel: string; opensInPage: boolean; sizeBytes: number;
  uploadedByName: string | null; createdAt: Date; isCurrent: boolean;
};
export type DocumentView = {
  id: string; projectId: string; projectName: string; title: string; number: string | null; category: DocCategory; description: string | null; archived: boolean;
  current: RevisionView | null; revisionCount: number; revisions: RevisionView[]; canWrite: boolean; createdByName: string | null;
};

const select = {
  id: true, projectId: true, title: true, number: true, category: true, description: true, archivedAt: true,
  project: { select: { name: true } }, createdBy: { select: { name: true } },
  revisions: { orderBy: { createdAt: "desc" as const }, select: { id: true, revision: true, note: true, issuedOn: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true, uploadedBy: { select: { name: true } } } },
} as const;

type Row = {
  id: string; projectId: string; title: string; number: string | null; category: string; description: string | null; archivedAt: Date | null; project: { name: string }; createdBy: { name: string | null } | null;
  revisions: { id: string; revision: string; note: string | null; issuedOn: Date; fileName: string; contentType: string; sizeBytes: number; createdAt: Date; uploadedBy: { name: string | null } | null }[];
};

function view(user: DocUser, d: Row, withHistory: boolean): DocumentView {
  const revisions: RevisionView[] = d.revisions.map((r, i) => {
    const f = formatOf(r.contentType);
    return { id: r.id, revision: r.revision, note: r.note, issuedOn: ymd(r.issuedOn), fileName: r.fileName, contentType: r.contentType, formatLabel: f?.label ?? "File", opensInPage: f?.inline ?? false, sizeBytes: r.sizeBytes, uploadedByName: r.uploadedBy?.name ?? null, createdAt: r.createdAt, isCurrent: i === 0 };
  });
  return {
    id: d.id, projectId: d.projectId, projectName: d.project.name, title: d.title, number: d.number, category: d.category as DocCategory, description: d.description, archived: d.archivedAt !== null,
    current: revisions[0] ?? null, revisionCount: revisions.length, revisions: withHistory ? revisions : revisions.slice(0, 1), canWrite: can(user, "document:write"), createdByName: d.createdBy?.name ?? null,
  };
}

export async function listDocuments(user: DocUser, opts: { projectId?: string | null; category?: string | null; q?: string | null; includeArchived?: boolean } = {}): Promise<DocumentView[]> {
  if (!can(user, "site:view")) return [];
  const q = opts.q?.trim().slice(0, 80);
  const rows = await dbFor(user.orgId).projectDocument.findMany({
    where: {
      project: projectAccessWhere(user),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.category && (CATEGORIES as readonly string[]).includes(opts.category) ? { category: opts.category as DocCategory } : {}),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { number: { contains: q, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: [{ category: "asc" }, { number: "asc" }, { title: "asc" }],
    take: 300,
    select,
  });
  return (rows as unknown as Row[]).map((r) => view(user, r, false));
}

export async function getDocument(user: DocUser, id: string): Promise<DocumentView | null> {
  if (!can(user, "site:view")) return null;
  const d = await dbFor(user.orgId).projectDocument.findFirst({ where: { id, project: projectAccessWhere(user) }, select });
  return d ? view(user, d as unknown as Row, true) : null;
}

type NewFile = { name: string; bytes: Buffer };

async function throttle(user: DocUser) {
  const r = await hitAll([
    { key: limitKey("doc:user", user.id), limit: 30, windowSeconds: 600 },
    { key: limitKey("doc:org", user.orgId), limit: 500, windowSeconds: 86400 },
  ]);
  return r.allowed ? null : retryMessage(r.retryAfterSeconds);
}

/** Adds a new drawing or document with its first revision. */
export async function createDocument(user: DocUser, input: { projectId: string; data: unknown; file: NewFile | null }): Promise<FlowResult<{ id: string }>> {
  if (!can(user, "document:write")) return { ok: false, error: "Only an administrator or project manager can add drawings." };
  const project = await visibleProject(user, input.projectId);
  if (!project) return { ok: false, error: "Project not found." };
  const parsed = parseDocument(input.data, await today(user.orgId));
  if (!parsed.ok) return parsed;
  if (!input.file) return { ok: false, error: "Choose the file to add.", field: "file" };
  const busy = await throttle(user);
  if (busy) return { ok: false, error: busy };
  const v = parsed.value;
  const db = dbFor(user.orgId);
  if (v.number && (await db.projectDocument.count({ where: { projectId: project.id, number: v.number } })) > 0) {
    return { ok: false, error: `Drawing number ${v.number} is already used on this project. Add a new revision to that drawing instead.`, field: "number" };
  }
  const stored = await storeDocument(project.id, input.file.bytes, input.file.name);
  if (!stored.ok) return { ...stored, field: "file" };
  try {
    const created = await db.$transaction(async (tx) => {
      const doc = await tx.projectDocument.create({ data: { organizationId: user.orgId, projectId: project.id, title: v.title, number: v.number, category: v.category, description: v.description, createdById: user.id }, select: { id: true } });
      await tx.documentRevision.create({ data: { organizationId: user.orgId, documentId: doc.id, revision: v.revision, note: v.note, issuedOn: new Date(`${v.issuedOn}T00:00:00Z`), fileUrl: stored.fileUrl, fileName: stored.fileName, contentType: stored.format.contentType, sizeBytes: stored.sizeBytes, uploadedById: user.id } });
      return doc;
    });
    await logActivity({ userId: user.id, organizationId: user.orgId, action: "DOCUMENT_ADDED", module: "SITE", entityId: created.id, details: { project: project.name, title: v.title, number: v.number, revision: v.revision } });
    return { ok: true, id: created.id };
  } catch (error) {
    await removePhotos([stored.fileUrl]);
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "That drawing number was just used. Reload and try again.", field: "number" };
    throw error;
  }
}

/** Adds a new revision to a drawing; it becomes the current one. The older files stay in the history. */
export async function addRevision(user: DocUser, documentId: string, input: { data: unknown; file: NewFile | null }): Promise<FlowResult<{ id: string }>> {
  if (!can(user, "document:write")) return { ok: false, error: "Only an administrator or project manager can add revisions." };
  const doc = await getDocument(user, documentId);
  if (!doc) return { ok: false, error: "Drawing not found." };
  if (doc.archived) return { ok: false, error: "This drawing is archived. Bring it back before adding a revision." };
  const parsed = parseDocument(input.data, await today(user.orgId), { forNewDocument: false });
  if (!parsed.ok) return parsed;
  if (!input.file) return { ok: false, error: "Choose the file to add.", field: "file" };
  const v = parsed.value;
  if (doc.revisions.some((r) => r.revision === v.revision)) return { ok: false, error: `Revision ${v.revision} already exists. Use a new name such as the next letter.`, field: "revision" };
  const busy = await throttle(user);
  if (busy) return { ok: false, error: busy };
  const stored = await storeDocument(doc.projectId, input.file.bytes, input.file.name);
  if (!stored.ok) return { ...stored, field: "file" };
  try {
    const rev = await dbFor(user.orgId).documentRevision.create({
      data: { organizationId: user.orgId, documentId: doc.id, revision: v.revision, note: v.note, issuedOn: new Date(`${v.issuedOn}T00:00:00Z`), fileUrl: stored.fileUrl, fileName: stored.fileName, contentType: stored.format.contentType, sizeBytes: stored.sizeBytes, uploadedById: user.id },
      select: { id: true },
    });
    await dbFor(user.orgId).projectDocument.updateMany({ where: { id: doc.id }, data: { updatedAt: new Date() } });
    await logActivity({ userId: user.id, organizationId: user.orgId, action: "DOCUMENT_REVISION_ADDED", module: "SITE", entityId: doc.id, details: { title: doc.title, number: doc.number, revision: v.revision } });
    return { ok: true, id: rev.id };
  } catch (error) {
    await removePhotos([stored.fileUrl]);
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: `Revision ${v.revision} was just added. Reload and use the next name.`, field: "revision" };
    throw error;
  }
}

/** Archiving hides a drawing from the lists (it is never deleted: the history stays for audit). Bring it back the same way. */
export async function setArchived(user: DocUser, documentId: string, archived: boolean): Promise<FlowResult> {
  if (!can(user, "document:write")) return { ok: false, error: "Only an administrator or project manager can archive drawings." };
  const doc = await getDocument(user, documentId);
  if (!doc) return { ok: false, error: "Drawing not found." };
  await dbFor(user.orgId).projectDocument.updateMany({ where: { id: doc.id }, data: { archivedAt: archived ? new Date() : null } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "DOCUMENT_ARCHIVED", module: "SITE", entityId: doc.id, details: { title: doc.title, archived } });
  return { ok: true };
}

/** One stored file, only if this person may see its project. */
export async function revisionFile(user: DocUser, revisionId: string) {
  if (!can(user, "site:view")) return null;
  const r = await dbFor(user.orgId).documentRevision.findFirst({ where: { id: revisionId, document: { project: projectAccessWhere(user) } }, select: { fileUrl: true, contentType: true, fileName: true } });
  return r;
}

export async function readRevision(fileUrl: string) {
  return readPhoto(fileUrl);
}

/** What the "recent drawings" part of a project's page needs: the newest revisions across the person's projects. */
export async function recentRevisions(user: DocUser, take = 5) {
  if (!can(user, "site:view")) return [];
  const rows = await dbFor(user.orgId).documentRevision.findMany({
    where: { document: { archivedAt: null, project: projectAccessWhere(user) } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, revision: true, createdAt: true, document: { select: { id: true, title: true, number: true, project: { select: { name: true } } } } },
  });
  return rows.map((r) => ({ id: r.id, revision: r.revision, createdAt: r.createdAt, documentId: r.document.id, title: r.document.title, number: r.document.number, projectName: r.document.project.name }));
}
