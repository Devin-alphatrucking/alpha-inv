import { dbFor } from "@/lib/org/scoped-db";
import { rawDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { hasPermission, seesAllProjects } from "@/lib/roles";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { removePhotos, storePhoto } from "@/lib/site/storage";
import {
  canEditReport, cleanLabel, isYmd, nextStatuses, parseIssue, parseReport, PHOTOS_PER_UPLOAD,
  type IssueState, type ReportStatus,
} from "@/lib/site/rules";
import type { FlowResult } from "@/lib/flows/schemas";
import { BAD_REF, REF_TAKEN, clientRefOf, isUniqueViolation } from "@/lib/idempotency";

/**
 * Site work: the daily report, photos and issues of a project. Everything starts from "which project may this person see":
 * administrators and accountants see all of them, everyone else only the projects they are assigned to. Someone who cannot see
 * a project cannot tell its reports, photos or issues exist.
 */

export type SiteUser = ProjectUser;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const can = (user: SiteUser, p: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, p);

export async function visibleProject(user: SiteUser, projectId: string) {
  if (!can(user, "site:view")) return null;
  return dbFor(user.orgId).project.findFirst({ where: { id: projectId, ...projectAccessWhere(user) }, select: { id: true, name: true, status: true } });
}

export async function companyToday(orgId: string) {
  return todayIn(await companyTimeZone(orgId));
}

async function throttle(user: SiteUser, kind: string, perUser: number, perCompany: number) {
  const r = await hitAll([
    { key: limitKey(`site:${kind}:user`, user.id), limit: perUser, windowSeconds: 600 },
    { key: limitKey(`site:${kind}:org`, user.orgId), limit: perCompany, windowSeconds: 86400 },
  ]);
  return r.allowed ? null : retryMessage(r.retryAfterSeconds);
}

// ---- reports

export type ReportView = {
  id: string; projectId: string; reportDate: string; weather: string | null; workDone: string; labourCount: number | null;
  machinery: string | null; materialsUsed: string | null; problems: string | null; safetyNote: string | null;
  status: ReportStatus; submittedAt: Date | null; authorName: string | null; submittedByName: string | null;
  canEdit: boolean; canSubmit: boolean; canReopen: boolean;
};

async function reportView(user: SiteUser, r: {
  id: string; projectId: string; reportDate: Date; weather: string | null; workDone: string; labourCount: number | null; machinery: string | null;
  materialsUsed: string | null; problems: string | null; safetyNote: string | null; status: ReportStatus; submittedAt: Date | null; createdById: string | null; submittedById: string | null;
}): Promise<ReportView> {
  const ids = [r.createdById, r.submittedById].filter((x): x is string => !!x);
  const people = ids.length ? await rawDb.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const w = can(user, "site:write");
  const m = can(user, "site:manage");
  return {
    id: r.id, projectId: r.projectId, reportDate: ymd(r.reportDate), weather: r.weather, workDone: r.workDone, labourCount: r.labourCount,
    machinery: r.machinery, materialsUsed: r.materialsUsed, problems: r.problems, safetyNote: r.safetyNote, status: r.status, submittedAt: r.submittedAt,
    authorName: name(r.createdById), submittedByName: name(r.submittedById),
    canEdit: canEditReport(r.status, w, m), canSubmit: r.status === "DRAFT" && (w || m), canReopen: r.status === "SUBMITTED" && m,
  };
}

export async function getReport(user: SiteUser, projectId: string, date: string): Promise<ReportView | null> {
  if (!isYmd(date) || !(await visibleProject(user, projectId))) return null;
  const r = await dbFor(user.orgId).siteReport.findFirst({ where: { projectId, reportDate: toDate(date) } });
  return r ? reportView(user, r as never) : null;
}

export async function saveReport(user: SiteUser, projectId: string, raw: unknown): Promise<FlowResult<{ id: string }>> {
  if (!can(user, "site:write")) return { ok: false, error: "You do not have permission to write site reports." };
  const project = await visibleProject(user, projectId);
  if (!project) return { ok: false, error: "Project not found." };
  const parsed = parseReport(raw, await companyToday(user.orgId));
  if (!parsed.ok) return parsed;
  const busy = await throttle(user, "report", 60, 1000);
  if (busy) return { ok: false, error: busy };

  const db = dbFor(user.orgId);
  const v = parsed.value;
  const fields = { weather: v.weather, workDone: v.workDone, labourCount: v.labourCount, machinery: v.machinery, materialsUsed: v.materialsUsed, problems: v.problems, safetyNote: v.safetyNote };
  const where = { projectId: project.id, reportDate: toDate(v.reportDate) };

  const existing = await db.siteReport.findFirst({ where, select: { id: true, status: true } });
  if (existing) {
    if (!canEditReport(existing.status as ReportStatus, true, can(user, "site:manage"))) {
      return { ok: false, error: "This report was submitted and is locked. A project manager can reopen it." };
    }
    // The status is part of the condition: a report submitted a moment ago cannot be overwritten by a stale form.
    const n = await db.siteReport.updateMany({ where: { id: existing.id, ...(can(user, "site:manage") ? {} : { status: "DRAFT" }) }, data: fields });
    if (n.count === 0) return { ok: false, error: "This report was submitted just now and is locked." };
    await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_REPORT_SAVED", module: "SITE", entityId: existing.id, details: { project: project.name, date: v.reportDate } });
    return { ok: true, id: existing.id };
  }
  try {
    const created = await db.siteReport.create({ data: { organizationId: user.orgId, projectId: project.id, reportDate: where.reportDate, createdById: user.id, ...fields }, select: { id: true } });
    await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_REPORT_SAVED", module: "SITE", entityId: created.id, details: { project: project.name, date: v.reportDate, created: true } });
    return { ok: true, id: created.id };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ok: false, error: "Someone just started this day's report. Reload the page to see it." };
    throw error;
  }
}

async function reportOf(user: SiteUser, reportId: string) {
  const r = await dbFor(user.orgId).siteReport.findFirst({ where: { id: reportId }, select: { id: true, projectId: true, status: true, reportDate: true } });
  if (!r || !(await visibleProject(user, r.projectId))) return null;
  return r;
}

export async function submitReport(user: SiteUser, reportId: string): Promise<FlowResult> {
  if (!can(user, "site:write")) return { ok: false, error: "You do not have permission to submit site reports." };
  const r = await reportOf(user, reportId);
  if (!r) return { ok: false, error: "Report not found." };
  const n = await dbFor(user.orgId).siteReport.updateMany({ where: { id: r.id, status: "DRAFT" }, data: { status: "SUBMITTED", submittedById: user.id, submittedAt: new Date() } });
  if (n.count === 0) return { ok: false, error: "This report is already submitted." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_REPORT_SUBMITTED", module: "SITE", entityId: r.id, details: { date: ymd(r.reportDate) } });
  return { ok: true };
}

export async function reopenReport(user: SiteUser, reportId: string): Promise<FlowResult> {
  if (!can(user, "site:manage")) return { ok: false, error: "Only a project manager can reopen a submitted report." };
  const r = await reportOf(user, reportId);
  if (!r) return { ok: false, error: "Report not found." };
  const n = await dbFor(user.orgId).siteReport.updateMany({ where: { id: r.id, status: "SUBMITTED" }, data: { status: "DRAFT", submittedById: null, submittedAt: null } });
  if (n.count === 0) return { ok: false, error: "This report is not submitted." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_REPORT_REOPENED", module: "SITE", entityId: r.id, details: { date: ymd(r.reportDate) } });
  return { ok: true };
}

export type ReportRow = { id: string; projectId: string; projectName: string; reportDate: string; status: ReportStatus; workDone: string; labourCount: number | null };

/** Newest reports across the projects this person can see (optionally one project). */
export async function listReports(user: SiteUser, opts: { projectId?: string | null; take?: number } = {}): Promise<ReportRow[]> {
  if (!can(user, "site:view")) return [];
  const rows = await dbFor(user.orgId).siteReport.findMany({
    where: { project: projectAccessWhere(user), ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(opts.take ?? 20, 200),
    select: { id: true, projectId: true, reportDate: true, status: true, workDone: true, labourCount: true, project: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, projectId: r.projectId, projectName: r.project.name, reportDate: ymd(r.reportDate), status: r.status as ReportStatus, workDone: r.workDone, labourCount: r.labourCount }));
}

// ---- photos

export type PhotoView = { id: string; projectId: string; projectName: string; reportId: string | null; issueId: string | null; takenOn: string; caption: string | null; area: string | null; uploaderName: string | null; createdAt: Date; canDelete: boolean };

async function photoViews(user: SiteUser, rows: { id: string; projectId: string; reportId: string | null; issueId: string | null; takenOn: Date; caption: string | null; area: string | null; uploadedById: string | null; createdAt: Date; project: { name: string }; report: { status: string } | null; uploadedBy: { name: string | null } | null }[]): Promise<PhotoView[]> {
  const m = can(user, "site:manage");
  return rows.map((p) => ({
    id: p.id, projectId: p.projectId, projectName: p.project.name, reportId: p.reportId, issueId: p.issueId, takenOn: ymd(p.takenOn), caption: p.caption, area: p.area,
    uploaderName: p.uploadedBy?.name ?? null, createdAt: p.createdAt,
    canDelete: m || (can(user, "site:write") && p.uploadedById === user.id && p.report?.status !== "SUBMITTED"),
  }));
}

const photoSelect = { id: true, projectId: true, reportId: true, issueId: true, takenOn: true, caption: true, area: true, uploadedById: true, createdAt: true, project: { select: { name: true } }, report: { select: { status: true } }, uploadedBy: { select: { name: true } } } as const;

export async function listPhotos(user: SiteUser, opts: { projectId?: string | null; reportId?: string; issueId?: string; receiptId?: string; take?: number } = {}): Promise<PhotoView[]> {
  if (!can(user, "site:view")) return [];
  const rows = await dbFor(user.orgId).sitePhoto.findMany({
    where: { project: projectAccessWhere(user), ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.reportId ? { reportId: opts.reportId } : {}), ...(opts.issueId ? { issueId: opts.issueId } : {}), ...(opts.receiptId ? { receiptId: opts.receiptId } : {}) },
    orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }],
    take: Math.min(opts.take ?? 60, 300),
    select: photoSelect,
  });
  return photoViews(user, rows as never);
}

export type NewPhotos = { projectId: string; reportId?: string | null; issueId?: string | null; receiptId?: string | null; clientRef?: unknown; area?: unknown; caption?: unknown; files: { name: string; bytes: Buffer }[] };

/** Adds up to 10 photos. A photo of a submitted report is refused unless the person can manage site work. */
export async function addPhotos(user: SiteUser, input: NewPhotos): Promise<FlowResult<{ added: number; skipped: string[] }>> {
  if (!can(user, "site:write") && !(input.receiptId && can(user, "delivery:write"))) return { ok: false, error: "You do not have permission to add site photos." };
  const project = await visibleProject(user, input.projectId);
  if (!project) return { ok: false, error: "Project not found." };
  if (input.files.length === 0) return { ok: false, error: "Choose at least one photo." };
  if (input.files.length > PHOTOS_PER_UPLOAD) return { ok: false, error: `Add at most ${PHOTOS_PER_UPLOAD} photos at a time.` };
  const busy = await throttle(user, "photo", 60, 3000);
  if (busy) return { ok: false, error: busy };

  const db = dbFor(user.orgId);
  let reportId: string | null = null;
  let takenOn = await companyToday(user.orgId);
  if (input.reportId) {
    const rep = await db.siteReport.findFirst({ where: { id: input.reportId, projectId: project.id }, select: { id: true, status: true, reportDate: true } });
    if (!rep) return { ok: false, error: "Report not found." };
    if (!canEditReport(rep.status as ReportStatus, true, can(user, "site:manage"))) return { ok: false, error: "This report is submitted and locked." };
    reportId = rep.id;
    takenOn = ymd(rep.reportDate);
  }
  let issueId: string | null = null;
  if (input.issueId) {
    const iss = await db.siteIssue.findFirst({ where: { id: input.issueId, projectId: project.id }, select: { id: true } });
    if (!iss) return { ok: false, error: "Issue not found." };
    issueId = iss.id;
  }
  let receiptId: string | null = null;
  if (input.receiptId) {
    const rec = await db.goodsReceipt.findFirst({ where: { id: input.receiptId, order: { projectId: project.id } }, select: { id: true } });
    if (!rec) return { ok: false, error: "Delivery not found." };
    receiptId = rec.id;
  }
  const area = cleanLabel(input.area, 120);
  const caption = cleanLabel(input.caption, 200);
  const baseRef = clientRefOf(input.clientRef);
  if (baseRef === false) return BAD_REF;

  let added = 0;
  const skipped: string[] = [];
  for (const [index, file] of input.files.entries()) {
    // One reference per file (the phone's reference plus the file's place in the batch), so a batch sent again adds only what is missing.
    const ref = baseRef ? `${baseRef.slice(0, 58)}-${index}` : null;
    if (ref) {
      const already = await db.sitePhoto.findFirst({ where: { clientRef: ref }, select: { id: true, uploadedById: true } });
      if (already) {
        if (already.uploadedById !== user.id) return REF_TAKEN;
        added++;
        continue;
      }
    }
    const stored = await storePhoto(project.id, file.bytes);
    if (!stored.ok) {
      skipped.push(`${file.name.slice(0, 60)}: ${stored.error}`);
      continue;
    }
    try {
      const row = await db.sitePhoto.create({
        data: { organizationId: user.orgId, projectId: project.id, reportId, issueId, receiptId, takenOn: toDate(takenOn), caption, area, fileUrl: stored.fileUrl, contentType: stored.contentType, sizeBytes: stored.sizeBytes, uploadedById: user.id, clientRef: ref },
        select: { id: true },
      });
      added++;
      await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_PHOTO_ADDED", module: "SITE", entityId: row.id, details: { project: project.name } });
    } catch (error) {
      await removePhotos([stored.fileUrl]);
      // the same photo arrived twice at the same moment: the other copy won, which is just as good
      if (ref && isUniqueViolation(error)) {
        added++;
        continue;
      }
      throw error;
    }
  }
  if (added === 0) return { ok: false, error: skipped[0] ?? "No photo could be added." };
  return { ok: true, added, skipped };
}

export async function deletePhoto(user: SiteUser, photoId: string): Promise<FlowResult> {
  const db = dbFor(user.orgId);
  const p = await db.sitePhoto.findFirst({ where: { id: photoId }, select: { id: true, projectId: true, fileUrl: true, uploadedById: true, report: { select: { status: true } } } });
  if (!p || !(await visibleProject(user, p.projectId))) return { ok: false, error: "Photo not found." };
  const allowed = can(user, "site:manage") || ((can(user, "site:write") || can(user, "delivery:write")) && p.uploadedById === user.id && p.report?.status !== "SUBMITTED");
  if (!allowed) return { ok: false, error: "Only the person who added a photo (before its report is submitted) or a project manager can delete it." };
  await db.sitePhoto.deleteMany({ where: { id: p.id } });
  await removePhotos([p.fileUrl]);
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_PHOTO_DELETED", module: "SITE", entityId: p.id });
  return { ok: true };
}

/** The stored file of a photo, only if this person may see its project. */
export async function photoFile(user: SiteUser, photoId: string) {
  if (!can(user, "site:view")) return null;
  return dbFor(user.orgId).sitePhoto.findFirst({ where: { id: photoId, project: projectAccessWhere(user) }, select: { fileUrl: true, contentType: true } });
}

// ---- issues

export type IssueView = {
  id: string; projectId: string; projectName: string; title: string; description: string | null; area: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; status: IssueState;
  assigneeId: string | null; assigneeName: string | null; raisedByName: string | null; dueDate: string | null; createdAt: Date; resolvedAt: Date | null; photoCount: number; canEdit: boolean; next: IssueState[];
};

const issueSelect = { id: true, projectId: true, title: true, description: true, area: true, severity: true, status: true, assigneeId: true, raisedById: true, dueDate: true, createdAt: true, resolvedAt: true, project: { select: { name: true } }, assignee: { select: { name: true } }, raisedBy: { select: { name: true } }, _count: { select: { photos: true } } } as const;

type IssueRow = { id: string; projectId: string; title: string; description: string | null; area: string | null; severity: "LOW" | "MEDIUM" | "HIGH"; status: IssueState; assigneeId: string | null; raisedById: string | null; dueDate: Date | null; createdAt: Date; resolvedAt: Date | null; project: { name: string }; assignee: { name: string | null } | null; raisedBy: { name: string | null } | null; _count: { photos: number } };

const canTouchIssue = (user: SiteUser, i: { raisedById: string | null; assigneeId: string | null }) =>
  can(user, "site:manage") || (can(user, "site:write") && (i.raisedById === user.id || i.assigneeId === user.id));

function issueView(user: SiteUser, i: IssueRow): IssueView {
  const m = can(user, "site:manage");
  return {
    id: i.id, projectId: i.projectId, projectName: i.project.name, title: i.title, description: i.description, area: i.area, severity: i.severity, status: i.status,
    assigneeId: i.assigneeId, assigneeName: i.assignee?.name ?? null, raisedByName: i.raisedBy?.name ?? null, dueDate: i.dueDate ? ymd(i.dueDate) : null, createdAt: i.createdAt, resolvedAt: i.resolvedAt,
    photoCount: i._count.photos, canEdit: canTouchIssue(user, i),
    // Anyone who writes site work can move an issue along; closing and reopening a closed one is for managers.
    next: can(user, "site:write") ? nextStatuses(i.status, m) : [],
  };
}

export async function listIssues(user: SiteUser, opts: { projectId?: string | null; status?: IssueState[]; take?: number } = {}): Promise<IssueView[]> {
  if (!can(user, "site:view")) return [];
  const rows = await dbFor(user.orgId).siteIssue.findMany({
    where: { project: projectAccessWhere(user), ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.status ? { status: { in: opts.status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 200, 500),
    select: issueSelect,
  });
  return (rows as unknown as IssueRow[]).map((r) => issueView(user, r));
}

export async function getIssue(user: SiteUser, issueId: string): Promise<IssueView | null> {
  if (!can(user, "site:view")) return null;
  const r = await dbFor(user.orgId).siteIssue.findFirst({ where: { id: issueId, project: projectAccessWhere(user) }, select: issueSelect });
  return r ? issueView(user, r as unknown as IssueRow) : null;
}

/** People who can be given an issue in this project: members of the company who can see it. */
export async function assignableUsers(user: SiteUser, projectId: string): Promise<{ id: string; name: string }[]> {
  if (!(await visibleProject(user, projectId))) return [];
  const members = await rawDb.membership.findMany({ where: { organizationId: user.orgId }, select: { userId: true, role: true, user: { select: { id: true, name: true, deletedAt: true } } } });
  const assigned = new Set((await dbFor(user.orgId).projectAssignment.findMany({ where: { projectId }, select: { userId: true } })).map((a) => a.userId));
  return members
    .filter((m) => !m.user.deletedAt && hasPermission(m.role as never, "site:view") && (seesAllProjects(m.role as never) || assigned.has(m.userId)))
    .map((m) => ({ id: m.user.id, name: m.user.name || "Unnamed" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function checkAssignee(user: SiteUser, projectId: string, assigneeId: string | null) {
  if (!assigneeId) return true;
  return (await assignableUsers(user, projectId)).some((u) => u.id === assigneeId);
}

export async function createIssue(user: SiteUser, projectId: string, raw: unknown, clientRefRaw?: unknown): Promise<FlowResult<{ id: string }>> {
  if (!can(user, "site:write")) return { ok: false, error: "You do not have permission to raise site issues." };
  const project = await visibleProject(user, projectId);
  if (!project) return { ok: false, error: "Project not found." };
  const ref = clientRefOf(clientRefRaw);
  if (ref === false) return BAD_REF;
  if (ref) {
    // The same save sent again (a lost reply, a retry from the phone): give back the issue already made.
    const existing = await dbFor(user.orgId).siteIssue.findFirst({ where: { clientRef: ref }, select: { id: true, raisedById: true, projectId: true } });
    if (existing) return existing.raisedById === user.id && existing.projectId === project.id ? { ok: true, id: existing.id } : REF_TAKEN;
  }
  const parsed = parseIssue(raw);
  if (!parsed.ok) return parsed;
  if (!(await checkAssignee(user, project.id, parsed.value.assigneeId))) return { ok: false, error: "Choose someone who works on this project.", field: "assigneeId" };
  const busy = await throttle(user, "issue", 40, 600);
  if (busy) return { ok: false, error: busy };
  const v = parsed.value;
  let created: { id: string };
  try {
    created = await dbFor(user.orgId).siteIssue.create({
      data: { organizationId: user.orgId, projectId: project.id, title: v.title, description: v.description, area: v.area, severity: v.severity, dueDate: v.dueDate ? toDate(v.dueDate) : null, assigneeId: v.assigneeId, raisedById: user.id, clientRef: ref },
      select: { id: true },
    });
  } catch (error) {
    // Two copies of the same save arrived at the same moment: the second finds the first.
    if (ref && isUniqueViolation(error)) {
      const won = await dbFor(user.orgId).siteIssue.findFirst({ where: { clientRef: ref, raisedById: user.id }, select: { id: true } });
      if (won) return { ok: true, id: won.id };
    }
    throw error;
  }
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_ISSUE_RAISED", module: "SITE", entityId: created.id, details: { project: project.name, title: v.title, severity: v.severity } });
  return { ok: true, id: created.id };
}

export async function updateIssue(user: SiteUser, issueId: string, raw: unknown): Promise<FlowResult> {
  const issue = await getIssue(user, issueId);
  if (!issue) return { ok: false, error: "Issue not found." };
  if (!issue.canEdit) return { ok: false, error: "Only the person who raised this issue, the person it is given to, or a project manager can change it." };
  const parsed = parseIssue(raw);
  if (!parsed.ok) return parsed;
  if (!(await checkAssignee(user, issue.projectId, parsed.value.assigneeId))) return { ok: false, error: "Choose someone who works on this project.", field: "assigneeId" };
  const v = parsed.value;
  await dbFor(user.orgId).siteIssue.updateMany({ where: { id: issue.id }, data: { title: v.title, description: v.description, area: v.area, severity: v.severity, dueDate: v.dueDate ? toDate(v.dueDate) : null, assigneeId: v.assigneeId } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_ISSUE_UPDATED", module: "SITE", entityId: issue.id, details: { title: v.title } });
  return { ok: true };
}

export async function setIssueStatus(user: SiteUser, issueId: string, to: unknown): Promise<FlowResult> {
  const issue = await getIssue(user, issueId);
  if (!issue) return { ok: false, error: "Issue not found." };
  if (typeof to !== "string" || !issue.next.includes(to as IssueState)) return { ok: false, error: "That change is not allowed for this issue." };
  const target = to as IssueState;
  // The old status is part of the condition, so two people acting at once cannot both succeed.
  const n = await dbFor(user.orgId).siteIssue.updateMany({
    where: { id: issue.id, status: issue.status },
    data: { status: target, resolvedAt: target === "FIXED" || target === "CLOSED" ? new Date() : null },
  });
  if (n.count === 0) return { ok: false, error: "Someone changed this issue just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SITE_ISSUE_STATUS", module: "SITE", entityId: issue.id, details: { from: issue.status, to: target } });
  return { ok: true };
}

// ---- overview

export type SiteOverview = {
  today: string;
  projects: { id: string; name: string; todayReport: ReportStatus | null; openIssues: number; overdueIssues: number }[];
};

/** For each project this person can see: is today's report written, and how many issues are open or late. */
export async function siteOverview(user: SiteUser): Promise<SiteOverview> {
  const today = await companyToday(user.orgId);
  if (!can(user, "site:view")) return { today, projects: [] };
  const db = dbFor(user.orgId);
  const projects = await db.project.findMany({ where: { status: "ACTIVE", ...projectAccessWhere(user) }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const ids = projects.map((p) => p.id);
  const [reports, issues] = await Promise.all([
    db.siteReport.findMany({ where: { projectId: { in: ids }, reportDate: toDate(today) }, select: { projectId: true, status: true } }),
    db.siteIssue.findMany({ where: { projectId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { projectId: true, dueDate: true } }),
  ]);
  return {
    today,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      todayReport: (reports.find((r) => r.projectId === p.id)?.status as ReportStatus | undefined) ?? null,
      openIssues: issues.filter((i) => i.projectId === p.id).length,
      overdueIssues: issues.filter((i) => i.projectId === p.id && i.dueDate && ymd(i.dueDate) < today).length,
    })),
  };
}
