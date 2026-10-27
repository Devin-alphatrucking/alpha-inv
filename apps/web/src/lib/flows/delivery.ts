import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/roles";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";
import { invoiceAccessWhere } from "@/lib/invoices/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import { lineProgress, matchInvoice, matchLine, orderProgress, parseReceipt, type LineProgress, type MatchResult, type OrderProgress } from "@/lib/purchase/delivery-rules";
import { isOpenForGoods, milliToString, OPEN_FOR_GOODS, statusForProgress, type OrderState } from "@/lib/purchase/rules";
import type { FlowResult } from "@/lib/flows/schemas";
import { BAD_REF, REF_TAKEN, clientRefOf, isUniqueViolation } from "@/lib/idempotency";

/**
 * Delivery check: what actually arrived on site against a sent purchase order, and whether a bill matches what was ordered and received.
 * The delivery screens show items and quantities only: prices stay with the people who may see orders.
 */

export type DeliveryUser = ProjectUser;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const can = (u: DeliveryUser, p: Parameters<typeof hasPermission>[1]) => hasPermission(u.role, p);
const milli = (d: { toString(): string }) => Math.round(Number(d.toString()) * 1000);
const num = (d: { toString(): string }) => Number(d.toString()).toString();

async function today(orgId: string) {
  return todayIn(await companyTimeZone(orgId));
}

/**
 * Keeps the order's status in step with what arrived: sent (nothing yet), part delivered, delivered. Run inside the same transaction that
 * records or removes a delivery, so the two can never disagree. A closed or cancelled order is left alone.
 */
type Tx = Parameters<Parameters<ReturnType<typeof dbFor>["$transaction"]>[0]>[0];
export async function syncOrderStatus(tx: Tx, orderId: string) {
  const o = await tx.purchaseOrder.findFirst({
    where: { id: orderId, status: { in: OPEN_FOR_GOODS } },
    select: { status: true, lines: { select: { id: true, quantity: true } }, receipts: { select: { receivedOn: true, lines: { select: { orderLineId: true, quantity: true } } } } },
  });
  if (!o) return;
  const got: Record<string, number> = {};
  for (const r of o.receipts) for (const l of r.lines) got[l.orderLineId] = (got[l.orderLineId] ?? 0) + milli(l.quantity);
  const target = statusForProgress(orderProgress(o.lines.map((l) => ({ orderedMilli: milli(l.quantity), receivedMilli: got[l.id] ?? 0 }))));
  if (target === o.status) return;
  await tx.purchaseOrder.updateMany({ where: { id: orderId, status: { in: OPEN_FOR_GOODS } }, data: { status: target, deliveredAt: target === "DELIVERED" ? new Date() : null } });
}

// ---------------------------------------------------------------- the delivery screen

export type DeliveryLine = { id: string; description: string; unit: string; ordered: string; received: string; rejected: string; remaining: string; progress: LineProgress };
export type ReceiptView = {
  id: string; receivedOn: string; challanNo: string | null; note: string | null; receivedByName: string | null; photoCount: number; canDelete: boolean; createdAt: Date;
  lines: { description: string; unit: string; quantity: string; rejected: string; remark: string | null }[];
};
export type DeliveryView = {
  orderId: string; number: string; status: OrderState; vendorName: string; projectId: string; projectName: string; deliveryDate: string | null;
  lines: DeliveryLine[]; progress: OrderProgress; receipts: ReceiptView[]; canRecord: boolean;
};

const orderInclude = {
  id: true, number: true, status: true, projectId: true, deliveryDate: true,
  project: { select: { name: true } }, vendor: { select: { name: true } },
  lines: { orderBy: { position: "asc" as const }, select: { id: true, description: true, unit: true, quantity: true } },
  receipts: {
    orderBy: [{ receivedOn: "desc" as const }, { createdAt: "desc" as const }] as { receivedOn?: "desc"; createdAt?: "desc" }[],
    select: {
      id: true, receivedOn: true, challanNo: true, note: true, receivedById: true, createdAt: true, receivedBy: { select: { name: true } }, _count: { select: { photos: true } },
      lines: { select: { orderLineId: true, quantity: true, rejected: true, remark: true } },
    },
  },
} as const;

export async function getDelivery(user: DeliveryUser, orderId: string): Promise<DeliveryView | null> {
  if (!can(user, "delivery:view")) return null;
  const o = await dbFor(user.orgId).purchaseOrder.findFirst({ where: { id: orderId, project: projectAccessWhere(user) }, select: orderInclude });
  if (!o) return null;
  const received: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  for (const r of o.receipts) for (const l of r.lines) {
    received[l.orderLineId] = (received[l.orderLineId] ?? 0) + milli(l.quantity);
    rejected[l.orderLineId] = (rejected[l.orderLineId] ?? 0) + milli(l.rejected);
  }
  const names = new Map(o.lines.map((l) => [l.id, l]));
  const lines: DeliveryLine[] = o.lines.map((l) => {
    const ordered = milli(l.quantity);
    const got = received[l.id] ?? 0;
    return { id: l.id, description: l.description, unit: l.unit, ordered: num(l.quantity), received: milliToString(got).replace(/\.?0+$/, "") || "0", rejected: milliToString(rejected[l.id] ?? 0).replace(/\.?0+$/, "") || "0", remaining: milliToString(Math.max(0, ordered - got)).replace(/\.?0+$/, "") || "0", progress: lineProgress(ordered, got) };
  });
  const orderLike = lines.map((l) => ({ orderedMilli: milli({ toString: () => l.ordered }), receivedMilli: milli({ toString: () => l.received }) }));
  const manage = can(user, "order:write");
  return {
    orderId: o.id, number: o.number, status: o.status as OrderState, vendorName: o.vendor.name, projectId: o.projectId, projectName: o.project.name, deliveryDate: o.deliveryDate ? ymd(o.deliveryDate) : null,
    lines, progress: orderProgress(orderLike),
    receipts: o.receipts.map((r) => ({
      id: r.id, receivedOn: ymd(r.receivedOn), challanNo: r.challanNo, note: r.note, receivedByName: r.receivedBy?.name ?? null, photoCount: r._count.photos, createdAt: r.createdAt,
      canDelete: can(user, "delivery:write") && (manage || (r.receivedById === user.id && Date.now() - r.createdAt.getTime() < 24 * 3600_000)),
      lines: r.lines.map((l) => ({ description: names.get(l.orderLineId)?.description ?? "", unit: names.get(l.orderLineId)?.unit ?? "", quantity: num(l.quantity), rejected: num(l.rejected), remark: l.remark })),
    })),
    canRecord: isOpenForGoods(o.status) && can(user, "delivery:write"),
  };
}

export type AwaitingRow = { orderId: string; number: string; vendorName: string; projectName: string; deliveryDate: string | null; progress: OrderProgress; late: boolean };

/** Sent orders, those still waiting for goods first. */
export async function listDeliveries(user: DeliveryUser, opts: { includeComplete?: boolean } = {}): Promise<AwaitingRow[]> {
  if (!can(user, "delivery:view")) return [];
  const t = await today(user.orgId);
  const rows = await dbFor(user.orgId).purchaseOrder.findMany({
    where: { status: { in: OPEN_FOR_GOODS }, project: projectAccessWhere(user) },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: { id: true, number: true, deliveryDate: true, project: { select: { name: true } }, vendor: { select: { name: true } }, lines: { select: { id: true, quantity: true } }, receipts: { select: { lines: { select: { orderLineId: true, quantity: true } } } } },
  });
  const out = rows.map((o) => {
    const got: Record<string, number> = {};
    for (const r of o.receipts) for (const l of r.lines) got[l.orderLineId] = (got[l.orderLineId] ?? 0) + milli(l.quantity);
    const progress = orderProgress(o.lines.map((l) => ({ orderedMilli: milli(l.quantity), receivedMilli: got[l.id] ?? 0 })));
    const dd = o.deliveryDate ? ymd(o.deliveryDate) : null;
    return { orderId: o.id, number: o.number, vendorName: o.vendor.name, projectName: o.project.name, deliveryDate: dd, progress, late: progress !== "RECEIVED" && dd !== null && dd < t };
  });
  return opts.includeComplete ? out : out.filter((r) => r.progress !== "RECEIVED");
}

export async function recordReceipt(user: DeliveryUser, orderId: string, raw: unknown, clientRefRaw?: unknown): Promise<FlowResult<{ id: string }>> {
  if (!can(user, "delivery:write")) return { ok: false, error: "You do not have permission to record deliveries." };
  const ref = clientRefOf(clientRefRaw);
  if (ref === false) return BAD_REF;
  const refValue: string | null = ref;
  if (ref) {
    // The same save sent again (a lost reply, a retry from the phone): give back the delivery already recorded, never a second one.
    const existing = await dbFor(user.orgId).goodsReceipt.findFirst({ where: { clientRef: ref }, select: { id: true, receivedById: true, orderId: true } });
    if (existing) return existing.receivedById === user.id && existing.orderId === orderId ? { ok: true, id: existing.id } : REF_TAKEN;
  }
  const view = await getDelivery(user, orderId);
  if (!view) return { ok: false, error: "Order not found." };
  if (!view.canRecord) return { ok: false, error: isOpenForGoods(view.status) ? "You cannot record deliveries here." : "Deliveries can only be recorded against an order that was sent to the supplier and is not closed or cancelled." };
  const parsed = parseReceipt(raw, await today(user.orgId), view.lines.map((l) => l.id));
  if (!parsed.ok) return parsed;
  const busy = await hitAll([
    { key: limitKey("delivery:user", user.id), limit: 40, windowSeconds: 600 },
    { key: limitKey("delivery:org", user.orgId), limit: 1000, windowSeconds: 86400 },
  ]);
  if (!busy.allowed) return { ok: false, error: retryMessage(busy.retryAfterSeconds) };
  const v = parsed.value;
  let created: { id: string } | null;
  try {
    created = await recordInTransaction();
  } catch (error) {
    if (ref && isUniqueViolation(error)) {
      const won = await dbFor(user.orgId).goodsReceipt.findFirst({ where: { clientRef: ref, receivedById: user.id }, select: { id: true } });
      if (won) return { ok: true, id: won.id };
    }
    throw error;
  }
  async function recordInTransaction() {
    return dbFor(user.orgId).$transaction(async (tx) => {
    // The order must still be open for goods: it may have been cancelled or closed while this form was open.
    const live = await tx.purchaseOrder.count({ where: { id: orderId, status: { in: OPEN_FOR_GOODS } } });
    if (live === 0) return null;
    const row = await tx.goodsReceipt.create({ data: { organizationId: user.orgId, orderId, receivedOn: toDate(v.receivedOn), challanNo: v.challanNo, note: v.note, receivedById: user.id, clientRef: refValue }, select: { id: true } });
    await tx.goodsReceiptLine.createMany({ data: v.lines.map((l) => ({ organizationId: user.orgId, receiptId: row.id, orderLineId: l.orderLineId, quantity: milliToString(l.quantityMilli), rejected: milliToString(l.rejectedMilli), remark: l.remark })) });
    await syncOrderStatus(tx, orderId);
    return row;
  });
  }
  if (!created) return { ok: false, error: "This order was cancelled just now." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "DELIVERY_RECORDED", module: "PURCHASE", entityId: created.id, details: { order: view.number, challan: v.challanNo, lines: v.lines.length } });
  return { ok: true, id: created.id };
}

export async function deleteReceipt(user: DeliveryUser, receiptId: string): Promise<FlowResult> {
  const r = await dbFor(user.orgId).goodsReceipt.findFirst({ where: { id: receiptId }, select: { id: true, orderId: true } });
  if (!r) return { ok: false, error: "Delivery not found." };
  const view = await getDelivery(user, r.orderId);
  const receipt = view?.receipts.find((x) => x.id === receiptId);
  if (!view || !receipt) return { ok: false, error: "Delivery not found." };
  if (!receipt.canDelete) return { ok: false, error: "Only the person who recorded a delivery (within a day) or the purchase officer can remove it." };
  await dbFor(user.orgId).$transaction(async (tx) => {
    await tx.goodsReceipt.deleteMany({ where: { id: r.id } });
    await syncOrderStatus(tx, r.orderId);
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "DELIVERY_DELETED", module: "PURCHASE", entityId: r.id, details: { order: view.number } });
  return { ok: true };
}

// ---------------------------------------------------------------- matching a bill with its order

export type MatchView = {
  invoiceId: string;
  linked: { orderId: string; number: string; vendorName: string; status: string } | null;
  result: (MatchResult & { progress: OrderProgress }) | null;
  candidates: { id: string; number: string; totalMinor: number; deliveryDate: string | null }[];
  canLink: boolean;
};

async function invoiceFor(user: DeliveryUser, invoiceId: string) {
  return dbFor(user.orgId).invoice.findFirst({
    where: { id: invoiceId, ...invoiceAccessWhere(user) },
    select: { id: true, createdAt: true, projectId: true, vendorId: true, subtotal: true, purchaseOrderId: true, lineItems: { select: { description: true, quantity: true, rateExclGst: true, materialId: true } } },
  });
}

const rateMinor = (d: { toString(): string }) => Math.round(Number(d.toString()) * 100);

export async function invoiceMatch(user: DeliveryUser, invoiceId: string): Promise<MatchView | null> {
  if (!can(user, "order:view")) return null;
  const inv = await invoiceFor(user, invoiceId);
  if (!inv) return null;
  const db = dbFor(user.orgId);
  const canLink = can(user, "invoice:review");

  if (!inv.purchaseOrderId) {
    const open = await db.purchaseOrder.findMany({
      where: { vendorId: inv.vendorId, projectId: inv.projectId, status: { in: [...OPEN_FOR_GOODS, "CLOSED"] }, project: projectAccessWhere(user) },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, number: true, deliveryDate: true, lines: { select: { quantity: true, rate: true, gstPercent: true } } },
    });
    return {
      invoiceId, linked: null, result: null, canLink,
      candidates: open.map((o) => ({ id: o.id, number: o.number, deliveryDate: o.deliveryDate ? ymd(o.deliveryDate) : null, totalMinor: o.lines.reduce((s, l) => s + Math.round(Number(l.quantity.toString()) * Number(l.rate.toString()) * 100 * (1 + Number(l.gstPercent.toString()) / 100)), 0) })),
    };
  }

  const order = await db.purchaseOrder.findFirst({
    where: { id: inv.purchaseOrderId, project: projectAccessWhere(user) },
    select: {
      id: true, number: true, status: true, vendor: { select: { name: true } },
      lines: { orderBy: { position: "asc" }, select: { id: true, description: true, unit: true, quantity: true, rate: true, materialId: true } },
      receipts: { select: { lines: { select: { orderLineId: true, quantity: true } } } },
    },
  });
  if (!order) return { invoiceId, linked: null, result: null, candidates: [], canLink };
  const got: Record<string, number> = {};
  for (const r of order.receipts) for (const l of r.lines) got[l.orderLineId] = (got[l.orderLineId] ?? 0) + milli(l.quantity);
  const orderLines = order.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantityMilli: milli(l.quantity), rateMinor: rateMinor(l.rate), materialId: l.materialId, receivedMilli: got[l.id] ?? 0 }));

  // What earlier bills for the same order already covered (a bill is judged against the bills before it, not the ones that came after).
  const others = await db.invoice.findMany({ where: { purchaseOrderId: order.id, id: { not: inv.id }, OR: [{ createdAt: { lt: inv.createdAt } }, { createdAt: inv.createdAt, id: { lt: inv.id } }] }, select: { subtotal: true, lineItems: { select: { description: true, quantity: true, materialId: true } } } });
  const before: Record<string, number> = {};
  let beforeSubtotal = 0;
  for (const o of others) {
    beforeSubtotal += rateMinor(o.subtotal);
    for (const l of o.lineItems) {
      const id = matchLine(l, orderLines);
      if (id) before[id] = (before[id] ?? 0) + milli(l.quantity);
    }
  }
  const result = matchInvoice({
    orderLines,
    orderSubtotalMinor: orderLines.reduce((s, l) => s + Math.round((l.quantityMilli * l.rateMinor) / 1000), 0),
    invoiceLines: inv.lineItems.map((l) => ({ description: l.description, quantityMilli: milli(l.quantity), rateMinor: rateMinor(l.rateExclGst), materialId: l.materialId })),
    invoiceSubtotalMinor: rateMinor(inv.subtotal),
    invoicedBefore: before,
    invoicedBeforeSubtotalMinor: beforeSubtotal,
  });
  return {
    invoiceId, canLink, candidates: [],
    linked: { orderId: order.id, number: order.number, vendorName: order.vendor.name, status: order.status },
    result: { ...result, progress: orderProgress(orderLines.map((l) => ({ orderedMilli: l.quantityMilli, receivedMilli: l.receivedMilli }))) },
  };
}

/** Links a bill to a sent order of the same supplier and project (or removes the link with `orderId` null). */
export async function linkInvoice(user: DeliveryUser, invoiceId: string, orderId: string | null): Promise<FlowResult> {
  if (!can(user, "invoice:review") || !can(user, "order:view")) return { ok: false, error: "You do not have permission to link bills to orders." };
  const inv = await invoiceFor(user, invoiceId);
  if (!inv) return { ok: false, error: "Invoice not found." };
  const db = dbFor(user.orgId);
  if (orderId) {
    const order = await db.purchaseOrder.findFirst({ where: { id: orderId, project: projectAccessWhere(user) }, select: { id: true, number: true, vendorId: true, projectId: true, status: true } });
    if (!order) return { ok: false, error: "Order not found." };
    if (order.vendorId !== inv.vendorId) return { ok: false, error: "That order is for a different supplier." };
    if (order.projectId !== inv.projectId) return { ok: false, error: "That order is for a different project." };
    if (!isOpenForGoods(order.status) && order.status !== "CLOSED") return { ok: false, error: "A bill can only be linked to an order that was sent to the supplier." };
  }
  await db.invoice.updateMany({ where: { id: inv.id }, data: { purchaseOrderId: orderId } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "INVOICE_ORDER_LINKED", module: "PURCHASE", entityId: inv.id, details: { orderId } });
  return { ok: true };
}

export const companyTodayFor = today;
