import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { invoiceAccessWhere, type SessionUser } from "@/lib/invoices/access";
import { canDeleteComment, cleanComment } from "@/lib/invoices/comment-rules";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * A comment can be read and added by anyone who can see the invoice (administrators: every invoice; staff: their own uploads
 * and their assigned projects). It can be removed by its author or an administrator.
 */

export type CommentView = { id: string; body: string; createdAt: Date; authorName: string; mine: boolean; canDelete: boolean };

/** The invoice, only if this person may see it. */
async function visibleInvoice(user: SessionUser, invoiceId: string) {
  return dbFor(user.orgId).invoice.findFirst({ where: { id: invoiceId, ...invoiceAccessWhere(user) }, select: { id: true, invoiceNumber: true } });
}

export async function listComments(user: SessionUser, invoiceId: string): Promise<CommentView[]> {
  if (!(await visibleInvoice(user, invoiceId))) return [];
  const rows = await dbFor(user.orgId).invoiceComment.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, body: true, createdAt: true, userId: true, user: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    authorName: r.user?.name || "Former member",
    mine: r.userId === user.id,
    canDelete: canDeleteComment(user, r),
  }));
}

export async function addComment(user: SessionUser, invoiceId: string, raw: unknown): Promise<FlowResult<{ id: string }>> {
  const cleaned = cleanComment(raw);
  if (!cleaned.ok) return { ok: false, error: cleaned.error, field: "body" };

  const limit = await hitAll([
    { key: limitKey("comment:user", user.id), limit: 30, windowSeconds: 600 },
    { key: limitKey("comment:org", user.orgId), limit: 600, windowSeconds: 86400 },
  ]);
  if (!limit.allowed) return { ok: false, error: retryMessage(limit.retryAfterSeconds) };

  const invoice = await visibleInvoice(user, invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const created = await dbFor(user.orgId).invoiceComment.create({
    data: { organizationId: user.orgId, invoiceId: invoice.id, userId: user.id, body: cleaned.body },
    select: { id: true },
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "INVOICE_COMMENT_ADDED", module: "INVOICE", entityId: invoice.id, details: { commentId: created.id, invoiceNumber: invoice.invoiceNumber } });
  return { ok: true, id: created.id };
}

export async function deleteComment(user: SessionUser, commentId: string): Promise<FlowResult> {
  const db = dbFor(user.orgId);
  const comment = await db.invoiceComment.findFirst({ where: { id: commentId }, select: { id: true, userId: true, invoiceId: true } });
  // Someone who cannot see the invoice cannot tell a comment on it exists.
  if (!comment || !(await visibleInvoice(user, comment.invoiceId))) return { ok: false, error: "Comment not found." };
  if (!canDeleteComment(user, comment)) return { ok: false, error: "Only the person who wrote a comment, or an administrator, can remove it." };

  await db.invoiceComment.deleteMany({ where: { id: comment.id } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "INVOICE_COMMENT_DELETED", module: "INVOICE", entityId: comment.invoiceId, details: { commentId: comment.id } });
  return { ok: true };
}
