"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { deleteReceipt, linkInvoice, recordReceipt } from "@/lib/flows/delivery";
import { cancelOrder, closeOrder, cancelRequest, createOrder, decideRequest, saveRequest, sendOrder, submitRequest, updateOrder, withdrawRequest } from "@/lib/flows/purchase";

// The person and the company come from the signed session, never from the browser; the flows check the project, the role and the status again.
const refresh = () => revalidatePath("/purchase", "layout");

export async function saveRequestAction(projectId: string, requestId: string | null, data: unknown, thenSubmit: boolean) {
  const user = await requirePermission("request:write");
  const r = await saveRequest(user, { requestId, projectId, data });
  if (r.ok && thenSubmit) {
    const s = await submitRequest(user, r.id);
    refresh();
    return s.ok ? r : ({ ok: false, error: `Saved as ${r.number}, but it could not be sent: ${s.error}` } as const);
  }
  if (r.ok) refresh();
  return r;
}

export async function submitRequestAction(id: string) {
  const user = await requirePermission("request:write");
  const r = await submitRequest(user, id);
  if (r.ok) refresh();
  return r;
}

export async function withdrawRequestAction(id: string) {
  const user = await requirePermission("request:write");
  const r = await withdrawRequest(user, id);
  if (r.ok) refresh();
  return r;
}

export async function cancelRequestAction(id: string) {
  const user = await requirePermission("request:view");
  const r = await cancelRequest(user, id);
  if (r.ok) refresh();
  return r;
}

export async function decideRequestAction(id: string, approve: boolean, note: string) {
  const user = await requirePermission("request:approve");
  const r = await decideRequest(user, id, approve, note);
  if (r.ok) refresh();
  return r;
}

export async function createOrderAction(projectId: string, requestId: string | null, data: unknown) {
  const user = await requirePermission("order:write");
  const r = await createOrder(user, { projectId, requestId, data });
  if (r.ok) refresh();
  return r;
}

export async function updateOrderAction(orderId: string, data: unknown) {
  const user = await requirePermission("order:write");
  const r = await updateOrder(user, orderId, data);
  if (r.ok) refresh();
  return r;
}

export async function sendOrderAction(orderId: string) {
  const user = await requirePermission("order:write");
  const r = await sendOrder(user, orderId);
  if (r.ok) refresh();
  return r;
}

export async function cancelOrderAction(orderId: string, reason: string) {
  const user = await requirePermission("order:write");
  const r = await cancelOrder(user, orderId, reason);
  if (r.ok) refresh();
  return r;
}

export async function closeOrderAction(orderId: string, reason: string) {
  const user = await requirePermission("order:write");
  const r = await closeOrder(user, orderId, reason);
  if (r.ok) refresh();
  return r;
}

export async function recordReceiptAction(orderId: string, data: unknown) {
  const user = await requirePermission("delivery:write");
  const r = await recordReceipt(user, orderId, data);
  if (r.ok) refresh();
  return r;
}

export async function deleteReceiptAction(receiptId: string) {
  const user = await requirePermission("delivery:write");
  const r = await deleteReceipt(user, receiptId);
  if (r.ok) refresh();
  return r;
}

export async function linkInvoiceAction(invoiceId: string, orderId: string | null) {
  const user = await requirePermission("order:view");
  const r = await linkInvoice(user, invoiceId, orderId);
  if (r.ok) {
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/invoices/${invoiceId}/review`);
  }
  return r;
}
