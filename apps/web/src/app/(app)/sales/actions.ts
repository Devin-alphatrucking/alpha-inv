"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { cancelInvoice, createCustomer, createInvoice, deleteReceipt, recordReceipt, saveProfile } from "@/lib/flows/sales";

// Thin wrappers for the Sales pages: the real work (and its tests) is in lib/flows/sales.ts, which also checks the add-on and the permission.

async function writer() {
  const u = await requirePermission("sales:write");
  return { id: u.id, orgId: u.orgId, role: u.role };
}

export async function saveProfileAction(input: Record<string, unknown>) {
  const r = await saveProfile(await writer(), input);
  revalidatePath("/sales", "layout");
  return r;
}

export async function createCustomerAction(input: Record<string, unknown>) {
  const r = await createCustomer(await writer(), input);
  revalidatePath("/sales", "layout");
  return r;
}

export async function createInvoiceAction(input: Record<string, unknown>) {
  const r = await createInvoice(await writer(), input);
  revalidatePath("/sales", "layout");
  return r;
}

export async function recordReceiptAction(invoiceId: string, input: Record<string, unknown>) {
  const r = await recordReceipt(await writer(), invoiceId, input);
  revalidatePath("/sales", "layout");
  return r;
}

export async function deleteReceiptAction(receiptId: string) {
  const r = await deleteReceipt(await writer(), receiptId);
  revalidatePath("/sales", "layout");
  return r;
}

export async function cancelInvoiceAction(invoiceId: string) {
  const r = await cancelInvoice(await writer(), invoiceId);
  revalidatePath("/sales", "layout");
  return r;
}
