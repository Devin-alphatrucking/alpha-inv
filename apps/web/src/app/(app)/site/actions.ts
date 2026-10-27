"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireUser } from "@/lib/permissions";
import { setArchived } from "@/lib/flows/documents";
import { createIssue, deletePhoto, reopenReport, saveReport, setIssueStatus, submitReport, updateIssue } from "@/lib/flows/site";

// The person and the company come from the signed session, never from the browser; the flows check the project and the role again.

export async function saveReportAction(projectId: string, input: unknown) {
  const user = await requirePermission("site:write");
  const r = await saveReport(user, projectId, input);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function submitReportAction(reportId: string) {
  const user = await requirePermission("site:write");
  const r = await submitReport(user, reportId);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function reopenReportAction(reportId: string) {
  const user = await requirePermission("site:manage");
  const r = await reopenReport(user, reportId);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function deletePhotoAction(photoId: string) {
  const user = await requireUser(); // the flow decides: the person who added it, or a manager
  const r = await deletePhoto(user, photoId);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function createIssueAction(projectId: string, input: unknown) {
  const user = await requirePermission("site:write");
  const r = await createIssue(user, projectId, input);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function updateIssueAction(issueId: string, input: unknown) {
  const user = await requirePermission("site:write");
  const r = await updateIssue(user, issueId, input);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function setIssueStatusAction(issueId: string, to: string) {
  const user = await requirePermission("site:write");
  const r = await setIssueStatus(user, issueId, to);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}

export async function archiveDocumentAction(documentId: string, archived: boolean) {
  const user = await requirePermission("document:write");
  const r = await setArchived(user, documentId, archived);
  if (r.ok) revalidatePath("/site", "layout");
  return r;
}
