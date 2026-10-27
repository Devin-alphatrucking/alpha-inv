import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/roles";
import { hitAll, limitKey, retryMessage } from "@/lib/security/rate-limit";
import { projectAccessWhere, type ProjectUser } from "@/lib/projects/access";
import { companyTimeZone } from "@/lib/invoices/company-tz";
import { todayIn } from "@/lib/invoices/status";
import {
  documentNumber, milliToString, minorToString, orderActions, parseClose, parseCancelReason, parseDecision, parseOrder, parseRequest, requestActions, lineAmount,
  type OrderAction, type OrderState, type RequestAction, type RequestState,
} from "@/lib/purchase/rules";
import type { FlowResult } from "@/lib/flows/schemas";
import { BAD_REF, REF_TAKEN, clientRefOf, isUniqueViolation } from "@/lib/idempotency";

/**
 * Purchase: material requests (an engineer asks, a manager approves) and purchase orders (the purchase officer orders from a supplier).
 * Everything starts from "which project may this person see": someone who cannot see a project cannot tell its requests or orders exist.
 */

export type PurchaseUser = ProjectUser;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const can = (u: PurchaseUser, p: Parameters<typeof hasPermission>[1]) => hasPermission(u.role, p);

async function today(orgId: string) {
  return todayIn(await companyTimeZone(orgId));
}

async function visibleProject(user: PurchaseUser, projectId: string) {
  if (!can(user, "request:view")) return null;
  return dbFor(user.orgId).project.findFirst({ where: { id: projectId, ...projectAccessWhere(user) }, select: { id: true, name: true, status: true } });
}

async function throttle(user: PurchaseUser, kind: string, perUser: number, perCompany: number) {
  const r = await hitAll([
    { key: limitKey(`purchase:${kind}:user`, user.id), limit: perUser, windowSeconds: 600 },
    { key: limitKey(`purchase:${kind}:org`, user.orgId), limit: perCompany, windowSeconds: 86400 },
  ]);
  return r.allowed ? null : retryMessage(r.retryAfterSeconds);
}

type Tx = Parameters<Parameters<ReturnType<typeof dbFor>["$transaction"]>[0]>[0];

/** The next number for MR or PO in this company and year, taken inside the same transaction as the document so no number is skipped or used twice. */
async function nextNumber(tx: Tx, orgId: string, kind: "MR" | "PO", year: number) {
  const rows = await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<{ last: number }[]> }).$queryRaw`
    INSERT INTO "DocumentCounter" (id, "organizationId", kind, year, last)
    VALUES (gen_random_uuid()::text, ${orgId}, ${kind}, ${year}, 1)
    ON CONFLICT ("organizationId", kind, year) DO UPDATE SET last = "DocumentCounter".last + 1
    RETURNING last`;
  return documentNumber(kind, year, Number(rows[0].last));
}

// ---------------------------------------------------------------- requests

export type RequestLineView = { id: string; description: string; unit: string; quantity: string; materialId: string | null };
export type RequestView = {
  id: string; number: string; projectId: string; projectName: string; status: RequestState; neededBy: string | null; note: string | null;
  requestedById: string | null; requestedByName: string | null; submittedAt: Date | null; decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null;
  createdAt: Date; lines: RequestLineView[]; actions: RequestAction[]; orders: { id: string; number: string; status: OrderState }[];
};

const requestSelect = {
  id: true, number: true, projectId: true, status: true, neededBy: true, note: true, requestedById: true, submittedAt: true, decidedAt: true, decisionNote: true, createdAt: true,
  project: { select: { name: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
  lines: { orderBy: { position: "asc" as const }, select: { id: true, description: true, unit: true, quantity: true, materialId: true } },
  orders: { select: { id: true, number: true, status: true }, orderBy: { createdAt: "asc" as const } },
} as const;

type RequestRow = {
  id: string; number: string; projectId: string; status: string; neededBy: Date | null; note: string | null; requestedById: string | null; submittedAt: Date | null; decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
  project: { name: string }; requestedBy: { name: string | null } | null; decidedBy: { name: string | null } | null;
  lines: { id: string; description: string; unit: string; quantity: { toString(): string }; materialId: string | null }[]; orders: { id: string; number: string; status: string }[];
};

function requestView(user: PurchaseUser, r: RequestRow): RequestView {
  return {
    id: r.id, number: r.number, projectId: r.projectId, projectName: r.project.name, status: r.status as RequestState, neededBy: r.neededBy ? ymd(r.neededBy) : null, note: r.note,
    requestedById: r.requestedById, requestedByName: r.requestedBy?.name ?? null, submittedAt: r.submittedAt, decidedByName: r.decidedBy?.name ?? null, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    lines: r.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantity: Number(l.quantity.toString()).toString(), materialId: l.materialId })),
    actions: requestActions(r.status as RequestState, {
      isOwner: r.requestedById === user.id, canWrite: can(user, "request:write"), canApprove: can(user, "request:approve"), isAdmin: user.role === "ADMIN", canOrder: can(user, "order:write"),
    }),
    orders: (can(user, "order:view") ? r.orders : []).map((o) => ({ id: o.id, number: o.number, status: o.status as OrderState })),
  };
}

export async function getRequest(user: PurchaseUser, id: string): Promise<RequestView | null> {
  if (!can(user, "request:view")) return null;
  const r = await dbFor(user.orgId).materialRequest.findFirst({ where: { id, project: projectAccessWhere(user) }, select: requestSelect });
  return r ? requestView(user, r as unknown as RequestRow) : null;
}

export async function listRequests(user: PurchaseUser, opts: { projectId?: string | null; status?: RequestState[]; take?: number } = {}): Promise<RequestView[]> {
  if (!can(user, "request:view")) return [];
  const rows = await dbFor(user.orgId).materialRequest.findMany({
    where: { project: projectAccessWhere(user), ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.status ? { status: { in: opts.status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 300),
    select: requestSelect,
  });
  return (rows as unknown as RequestRow[]).map((r) => requestView(user, r));
}

/** Creates a request (no `requestId`) or replaces a draft's contents (with `requestId`). */
export async function saveRequest(user: PurchaseUser, input: { requestId?: string | null; projectId: string; data: unknown; clientRef?: unknown }): Promise<FlowResult<{ id: string; number: string }>> {
  if (!can(user, "request:write")) return { ok: false, error: "You do not have permission to raise material requests." };
  const project = await visibleProject(user, input.projectId);
  if (!project) return { ok: false, error: "Project not found." };
  if (project.status !== "ACTIVE") return { ok: false, error: "Requests can only be raised for active projects." };
  const ref = input.requestId ? null : clientRefOf(input.clientRef);
  if (ref === false) return BAD_REF;
  if (ref) {
    // The same save sent again (a lost reply, a retry from the phone): give back the request already made, never a second one.
    const existing = await dbFor(user.orgId).materialRequest.findFirst({ where: { clientRef: ref }, select: { id: true, number: true, requestedById: true, projectId: true } });
    if (existing) return existing.requestedById === user.id && existing.projectId === project.id ? { ok: true, id: existing.id, number: existing.number } : REF_TAKEN;
  }
  const parsed = parseRequest(input.data, await today(user.orgId));
  if (!parsed.ok) return parsed;
  const busy = await throttle(user, "request", 40, 1000);
  if (busy) return { ok: false, error: busy };
  const v = parsed.value;
  const lineData = (id: string) => v.lines.map((l, i) => ({ organizationId: user.orgId, requestId: id, position: i, description: l.description, unit: l.unit, quantity: milliToString(l.quantityMilli), materialId: l.materialId }));
  const db = dbFor(user.orgId);

  if (input.requestId) {
    const existing = await getRequest(user, input.requestId);
    if (!existing || existing.projectId !== project.id) return { ok: false, error: "Request not found." };
    if (!existing.actions.includes("edit")) return { ok: false, error: "Only a draft can be changed. Take a submitted request back first." };
    const changed = await db.$transaction(async (tx) => {
      const n = await tx.materialRequest.updateMany({ where: { id: existing.id, status: "DRAFT" }, data: { neededBy: v.neededBy ? toDate(v.neededBy) : null, note: v.note } });
      if (n.count === 0) return false;
      await tx.materialRequestLine.deleteMany({ where: { requestId: existing.id } });
      await tx.materialRequestLine.createMany({ data: lineData(existing.id) });
      return true;
    });
    if (!changed) return { ok: false, error: "This request was changed just now. Reload and try again." };
    await logActivity({ userId: user.id, organizationId: user.orgId, action: "REQUEST_SAVED", module: "PURCHASE", entityId: existing.id, details: { number: existing.number } });
    return { ok: true, id: existing.id, number: existing.number };
  }

  const year = Number((await today(user.orgId)).slice(0, 4));
  let created: { id: string; number: string };
  try {
    created = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, user.orgId, "MR", year);
      const row = await tx.materialRequest.create({ data: { organizationId: user.orgId, projectId: project.id, number, neededBy: v.neededBy ? toDate(v.neededBy) : null, note: v.note, requestedById: user.id, clientRef: ref }, select: { id: true, number: true } });
      await tx.materialRequestLine.createMany({ data: lineData(row.id) });
      return row;
    });
  } catch (error) {
    if (ref && isUniqueViolation(error)) {
      const won = await db.materialRequest.findFirst({ where: { clientRef: ref, requestedById: user.id }, select: { id: true, number: true } });
      if (won) return { ok: true, id: won.id, number: won.number };
    }
    throw error;
  }
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "REQUEST_SAVED", module: "PURCHASE", entityId: created.id, details: { number: created.number, project: project.name, created: true } });
  return { ok: true, id: created.id, number: created.number };
}

async function moveRequest(user: PurchaseUser, id: string, action: RequestAction, from: RequestState[], data: Record<string, unknown>, log: "REQUEST_SUBMITTED" | "REQUEST_WITHDRAWN" | "REQUEST_DECIDED" | "REQUEST_CANCELLED", details: Record<string, unknown> = {}): Promise<FlowResult> {
  const r = await getRequest(user, id);
  if (!r) return { ok: false, error: "Request not found." };
  if (!r.actions.includes(action)) return { ok: false, error: "You cannot do that with this request." };
  const n = await dbFor(user.orgId).materialRequest.updateMany({ where: { id: r.id, status: { in: from } }, data: data as never });
  if (n.count === 0) return { ok: false, error: "Someone changed this request just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: log, module: "PURCHASE", entityId: r.id, details: { number: r.number, ...details } });
  return { ok: true };
}

export const submitRequest = (user: PurchaseUser, id: string) => moveRequest(user, id, "submit", ["DRAFT"], { status: "SUBMITTED", submittedAt: new Date(), decidedById: null, decidedAt: null, decisionNote: null }, "REQUEST_SUBMITTED");
export const withdrawRequest = (user: PurchaseUser, id: string) => moveRequest(user, id, "withdraw", ["SUBMITTED"], { status: "DRAFT", submittedAt: null }, "REQUEST_WITHDRAWN");
export const cancelRequest = (user: PurchaseUser, id: string) => moveRequest(user, id, "cancel", ["DRAFT", "SUBMITTED", "APPROVED"], { status: "CANCELLED" }, "REQUEST_CANCELLED");

export async function decideRequest(user: PurchaseUser, id: string, approve: boolean, noteRaw: unknown): Promise<FlowResult> {
  const d = parseDecision(approve, noteRaw);
  if (!d.ok) return d;
  return moveRequest(user, id, approve ? "approve" : "reject", ["SUBMITTED"], { status: approve ? "APPROVED" : "REJECTED", decidedById: user.id, decidedAt: new Date(), decisionNote: d.note }, "REQUEST_DECIDED", { approved: approve });
}

// ---------------------------------------------------------------- orders

export type OrderLineView = { id: string; description: string; unit: string; quantity: string; rate: string; gstPercent: string; amountMinor: number; gstMinor: number; totalMinor: number; materialId: string | null };
export type OrderView = {
  id: string; number: string; projectId: string; projectName: string; vendorId: string; vendorName: string; vendorGstin: string | null; vendorAddress: string | null; vendorContact: string | null;
  requestId: string | null; requestNumber: string | null; status: OrderState; orderDate: string; deliveryDate: string | null; deliveryAddress: string | null; paymentTerms: string | null; note: string | null;
  createdByName: string | null; sentAt: Date | null; cancelledAt: Date | null; cancelReason: string | null; deliveredAt: Date | null; closedAt: Date | null; closeReason: string | null; createdAt: Date;
  lines: OrderLineView[]; subtotalMinor: number; gstMinor: number; totalMinor: number; actions: OrderAction[];
};

const orderSelect = {
  id: true, number: true, projectId: true, vendorId: true, requestId: true, status: true, orderDate: true, deliveryDate: true, deliveryAddress: true, paymentTerms: true, note: true,
  sentAt: true, cancelledAt: true, cancelReason: true, deliveredAt: true, closedAt: true, closeReason: true, createdAt: true,
  project: { select: { name: true } }, vendor: { select: { name: true, gstin: true, address: true, contact: true } }, request: { select: { number: true } }, createdBy: { select: { name: true } },
  lines: { orderBy: { position: "asc" as const }, select: { id: true, description: true, unit: true, quantity: true, rate: true, gstPercent: true, materialId: true } },
} as const;

type OrderRow = {
  id: string; number: string; projectId: string; vendorId: string; requestId: string | null; status: string; orderDate: Date; deliveryDate: Date | null; deliveryAddress: string | null; paymentTerms: string | null; note: string | null;
  sentAt: Date | null; cancelledAt: Date | null; cancelReason: string | null; deliveredAt: Date | null; closedAt: Date | null; closeReason: string | null; createdAt: Date; project: { name: string };
  vendor: { name: string; gstin: string | null; address: string | null; contact: string | null }; request: { number: string } | null; createdBy: { name: string | null } | null;
  lines: { id: string; description: string; unit: string; quantity: { toString(): string }; rate: { toString(): string }; gstPercent: { toString(): string }; materialId: string | null }[];
};

function orderView(user: PurchaseUser, o: OrderRow): OrderView {
  const lines: OrderLineView[] = o.lines.map((l) => {
    const quantityMilli = Math.round(Number(l.quantity.toString()) * 1000);
    const rateMinor = Math.round(Number(l.rate.toString()) * 100);
    const gstBps = Math.round(Number(l.gstPercent.toString()) * 100);
    return { id: l.id, description: l.description, unit: l.unit, quantity: Number(l.quantity.toString()).toString(), rate: Number(l.rate.toString()).toFixed(2), gstPercent: Number(l.gstPercent.toString()).toString(), materialId: l.materialId, ...lineAmount(quantityMilli, rateMinor, gstBps) };
  });
  const totals = { subtotalMinor: lines.reduce((s, l) => s + l.amountMinor, 0), gstMinor: lines.reduce((s, l) => s + l.gstMinor, 0) };
  return {
    id: o.id, number: o.number, projectId: o.projectId, projectName: o.project.name, vendorId: o.vendorId, vendorName: o.vendor.name, vendorGstin: o.vendor.gstin, vendorAddress: o.vendor.address, vendorContact: o.vendor.contact,
    requestId: o.requestId, requestNumber: o.request?.number ?? null, status: o.status as OrderState, orderDate: ymd(o.orderDate), deliveryDate: o.deliveryDate ? ymd(o.deliveryDate) : null,
    deliveryAddress: o.deliveryAddress, paymentTerms: o.paymentTerms, note: o.note, createdByName: o.createdBy?.name ?? null, sentAt: o.sentAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason, deliveredAt: o.deliveredAt, closedAt: o.closedAt, closeReason: o.closeReason, createdAt: o.createdAt,
    lines, ...totals, totalMinor: totals.subtotalMinor + totals.gstMinor, actions: orderActions(o.status as OrderState, can(user, "order:write")),
  };
}

export async function getOrder(user: PurchaseUser, id: string): Promise<OrderView | null> {
  if (!can(user, "order:view")) return null;
  const o = await dbFor(user.orgId).purchaseOrder.findFirst({ where: { id, project: projectAccessWhere(user) }, select: orderSelect });
  return o ? orderView(user, o as unknown as OrderRow) : null;
}

export async function listOrders(user: PurchaseUser, opts: { projectId?: string | null; status?: OrderState[]; take?: number } = {}): Promise<OrderView[]> {
  if (!can(user, "order:view")) return [];
  const rows = await dbFor(user.orgId).purchaseOrder.findMany({
    where: { project: projectAccessWhere(user), ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.status ? { status: { in: opts.status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 300),
    select: orderSelect,
  });
  return (rows as unknown as OrderRow[]).map((r) => orderView(user, r));
}

export async function suppliers(user: PurchaseUser): Promise<{ id: string; name: string; gstin: string | null }[]> {
  if (!can(user, "order:write")) return [];
  return dbFor(user.orgId).vendor.findMany({ orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true, gstin: true } });
}

/** Re-checks the request and supplier named in an order, and that the person may order for the project. */
async function orderContext(user: PurchaseUser, projectId: string, vendorId: string, requestId: string | null) {
  const project = await visibleProject(user, projectId);
  if (!project) return { ok: false as const, error: "Project not found." };
  const vendor = await dbFor(user.orgId).vendor.findFirst({ where: { id: vendorId }, select: { id: true, name: true } });
  if (!vendor) return { ok: false as const, error: "Choose a supplier from your list.", field: "vendorId" };
  if (requestId) {
    const req = await getRequest(user, requestId);
    if (!req || req.projectId !== project.id) return { ok: false as const, error: "Request not found." };
    if (req.status !== "APPROVED" && req.status !== "ORDERED") return { ok: false as const, error: "Only an approved request can be ordered." };
  }
  return { ok: true as const, project, vendor };
}

export async function createOrder(user: PurchaseUser, input: { projectId: string; requestId?: string | null; data: unknown }): Promise<FlowResult<{ id: string; number: string }>> {
  if (!can(user, "order:write")) return { ok: false, error: "You do not have permission to raise purchase orders." };
  const t = await today(user.orgId);
  const parsed = parseOrder(input.data, t);
  if (!parsed.ok) return parsed;
  const requestId = input.requestId || null;
  const ctx = await orderContext(user, input.projectId, parsed.value.vendorId, requestId);
  if (!ctx.ok) return ctx;
  const busy = await throttle(user, "order", 40, 1000);
  if (busy) return { ok: false, error: busy };
  const v = parsed.value;
  const year = Number(v.orderDate.slice(0, 4));
  const created = await dbFor(user.orgId).$transaction(async (tx) => {
    const number = await nextNumber(tx, user.orgId, "PO", year);
    const row = await tx.purchaseOrder.create({
      data: { organizationId: user.orgId, projectId: ctx.project.id, vendorId: ctx.vendor.id, requestId, number, orderDate: toDate(v.orderDate), deliveryDate: v.deliveryDate ? toDate(v.deliveryDate) : null, deliveryAddress: v.deliveryAddress, paymentTerms: v.paymentTerms, note: v.note, createdById: user.id },
      select: { id: true, number: true },
    });
    await tx.purchaseOrderLine.createMany({ data: v.lines.map((l, i) => ({ organizationId: user.orgId, orderId: row.id, position: i, description: l.description, unit: l.unit, quantity: milliToString(l.quantityMilli), rate: minorToString(l.rateMinor), gstPercent: (l.gstBps / 100).toFixed(2), materialId: l.materialId })) });
    if (requestId) await tx.materialRequest.updateMany({ where: { id: requestId, status: { in: ["APPROVED", "ORDERED"] } }, data: { status: "ORDERED" } });
    return row;
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "ORDER_CREATED", module: "PURCHASE", entityId: created.id, details: { number: created.number, supplier: ctx.vendor.name, project: ctx.project.name } });
  return { ok: true, id: created.id, number: created.number };
}

export async function updateOrder(user: PurchaseUser, orderId: string, data: unknown): Promise<FlowResult> {
  const order = await getOrder(user, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.actions.includes("edit")) return { ok: false, error: "Only a draft order can be changed." };
  const parsed = parseOrder(data, await today(user.orgId));
  if (!parsed.ok) return parsed;
  const ctx = await orderContext(user, order.projectId, parsed.value.vendorId, null);
  if (!ctx.ok) return ctx;
  const v = parsed.value;
  const done = await dbFor(user.orgId).$transaction(async (tx) => {
    const n = await tx.purchaseOrder.updateMany({
      where: { id: order.id, status: "DRAFT" },
      data: { vendorId: ctx.vendor.id, orderDate: toDate(v.orderDate), deliveryDate: v.deliveryDate ? toDate(v.deliveryDate) : null, deliveryAddress: v.deliveryAddress, paymentTerms: v.paymentTerms, note: v.note },
    });
    if (n.count === 0) return false;
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: order.id } });
    await tx.purchaseOrderLine.createMany({ data: v.lines.map((l, i) => ({ organizationId: user.orgId, orderId: order.id, position: i, description: l.description, unit: l.unit, quantity: milliToString(l.quantityMilli), rate: minorToString(l.rateMinor), gstPercent: (l.gstBps / 100).toFixed(2), materialId: l.materialId })) });
    return true;
  });
  if (!done) return { ok: false, error: "This order was changed just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "ORDER_UPDATED", module: "PURCHASE", entityId: order.id, details: { number: order.number } });
  return { ok: true };
}

export async function sendOrder(user: PurchaseUser, orderId: string): Promise<FlowResult> {
  const order = await getOrder(user, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.actions.includes("send")) return { ok: false, error: "Only a draft order can be marked as sent." };
  if (order.lines.length === 0) return { ok: false, error: "Add at least one item first." };
  const n = await dbFor(user.orgId).purchaseOrder.updateMany({ where: { id: order.id, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date() } });
  if (n.count === 0) return { ok: false, error: "This order was changed just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "ORDER_SENT", module: "PURCHASE", entityId: order.id, details: { number: order.number, supplier: order.vendorName } });
  return { ok: true };
}

export async function cancelOrder(user: PurchaseUser, orderId: string, reasonRaw: unknown): Promise<FlowResult> {
  const order = await getOrder(user, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.actions.includes("cancel")) return { ok: false, error: "This order cannot be cancelled." };
  const reason = parseCancelReason(reasonRaw);
  if (!reason.ok) return reason;
  const db = dbFor(user.orgId);
  const done = await db.$transaction(async (tx) => {
    const n = await tx.purchaseOrder.updateMany({ where: { id: order.id, status: { in: ["DRAFT", "SENT"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.reason } });
    if (n.count === 0) return false;
    if (order.requestId) {
      // A request goes back to "approved" when none of its orders is still live, so it can be ordered again.
      const live = await tx.purchaseOrder.count({ where: { requestId: order.requestId, status: { not: "CANCELLED" } } });
      if (live === 0) await tx.materialRequest.updateMany({ where: { id: order.requestId, status: "ORDERED" }, data: { status: "APPROVED" } });
    }
    return true;
  });
  if (!done) return { ok: false, error: "This order was changed just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "ORDER_CANCELLED", module: "PURCHASE", entityId: order.id, details: { number: order.number, reason: reason.reason } });
  return { ok: true };
}

/** Closes an order that goods have arrived for: when everything came, or short (the rest is not coming, with a reason). */
export async function closeOrder(user: PurchaseUser, orderId: string, reasonRaw: unknown): Promise<FlowResult> {
  const order = await getOrder(user, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!order.actions.includes("close")) return { ok: false, error: "This order cannot be closed." };
  const reason = parseClose(order.status === "PART_DELIVERED", reasonRaw);
  if (!reason.ok) return reason;
  const n = await dbFor(user.orgId).purchaseOrder.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CLOSED", closedAt: new Date(), closeReason: reason.reason } });
  if (n.count === 0) return { ok: false, error: "This order was changed just now. Reload and try again." };
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "ORDER_CLOSED", module: "PURCHASE", entityId: order.id, details: { number: order.number, short: order.status === "PART_DELIVERED", reason: reason.reason } });
  return { ok: true };
}

// ---------------------------------------------------------------- overview

export type PurchaseOverview = { waitingForApproval: number; approvedToOrder: number; draftOrders: number; sentOrders: number; sentValueMinor: number };

export async function purchaseOverview(user: PurchaseUser): Promise<PurchaseOverview> {
  const [reqs, orders] = await Promise.all([listRequests(user, { status: ["SUBMITTED", "APPROVED"], take: 300 }), listOrders(user, { status: ["DRAFT", "SENT", "PART_DELIVERED"], take: 300 })]);
  return {
    waitingForApproval: reqs.filter((r) => r.status === "SUBMITTED").length,
    approvedToOrder: reqs.filter((r) => r.status === "APPROVED").length,
    draftOrders: orders.filter((o) => o.status === "DRAFT").length,
    // "On order": sent to the supplier and not yet fully delivered.
    sentOrders: orders.filter((o) => o.status === "SENT" || o.status === "PART_DELIVERED").length,
    sentValueMinor: orders.filter((o) => o.status === "SENT" || o.status === "PART_DELIVERED").reduce((s, o) => s + o.totalMinor, 0),
  };
}

