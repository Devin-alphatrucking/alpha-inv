"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { addComment, deleteComment } from "@/lib/flows/comments";

// The person and the company come from the signed session, never from the browser.
export async function addCommentAction(invoiceId: string, body: string) {
  const user = await requirePermission("comment:write");
  const result = await addComment({ id: user.id, role: user.role, orgId: user.orgId }, invoiceId, body);
  if (result.ok) {
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/invoices/${invoiceId}/review`);
  }
  return result;
}

export async function deleteCommentAction(invoiceId: string, commentId: string) {
  const user = await requirePermission("comment:write");
  const result = await deleteComment({ id: user.id, role: user.role, orgId: user.orgId }, commentId);
  if (result.ok) {
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/invoices/${invoiceId}/review`);
  }
  return result;
}
