import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { mergeProblem } from "@/lib/vendors/duplicates";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * Folds one supplier into another: every invoice of `fromId` moves to `intoId`, any detail the kept supplier lacks (GSTIN,
 * address, contact) is filled in from the other, and the other supplier is removed. Refused when the two have different GSTINs
 * or share an invoice number (see mergeProblem). Runs under the same lock invoice upload uses to find or create suppliers, so an
 * invoice being read at that moment cannot land on the supplier that is being removed.
 */

export type MergeUser = { id: string; orgId: string };

export async function mergeVendors(user: MergeUser, fromId: unknown, intoId: unknown): Promise<FlowResult<{ moved: number; keptName: string; removedName: string }>> {
  if (typeof fromId !== "string" || typeof intoId !== "string" || !fromId || !intoId) return { ok: false, error: "Choose both suppliers." };
  if (fromId === intoId) return { ok: false, error: "Choose two different suppliers." };
  const db = dbFor(user.orgId);

  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"vendor:" + user.orgId}))`;
    const [from, into] = await Promise.all([tx.vendor.findFirst({ where: { id: fromId } }), tx.vendor.findFirst({ where: { id: intoId } })]);
    if (!from || !into) return { error: "Supplier not found." } as const;

    const [fromInvoices, intoInvoices] = await Promise.all([
      tx.invoice.findMany({ where: { vendorId: from.id }, select: { invoiceNumber: true } }),
      tx.invoice.findMany({ where: { vendorId: into.id }, select: { invoiceNumber: true } }),
    ]);
    const problem = mergeProblem(from, into, fromInvoices.map((i) => i.invoiceNumber), intoInvoices.map((i) => i.invoiceNumber));
    if (problem) return { error: problem } as const;

    const moved = await tx.invoice.updateMany({ where: { vendorId: from.id }, data: { vendorId: into.id } });
    // The GSTIN is unique per company, so the supplier that holds it must go before the other can take it.
    await tx.vendor.deleteMany({ where: { id: from.id } });
    const fill: { gstin?: string; address?: string; contact?: string } = {};
    if (!into.gstin && from.gstin) fill.gstin = from.gstin;
    if (!into.address && from.address) fill.address = from.address;
    if (!into.contact && from.contact) fill.contact = from.contact;
    if (Object.keys(fill).length > 0) await tx.vendor.updateMany({ where: { id: into.id }, data: fill });
    return { error: undefined, moved: moved.count, from, into, fill } as const;
  });

  if (outcome.error !== undefined) return { ok: false, error: outcome.error };
  await logActivity({
    userId: user.id,
    organizationId: user.orgId,
    action: "VENDOR_MERGED",
    module: "VENDOR",
    entityId: outcome.into.id,
    details: { removed: { id: outcome.from.id, name: outcome.from.name, gstin: outcome.from.gstin }, kept: { id: outcome.into.id, name: outcome.into.name }, invoicesMoved: outcome.moved, filledIn: Object.keys(outcome.fill) },
  });
  return { ok: true, moved: outcome.moved, keptName: outcome.into.name, removedName: outcome.from.name };
}
