// Purchase and project reports: what was committed, received, billed and paid, and how suppliers delivered.
// Pure functions over plain facts (money in paise, quantities in thousandths), unit-tested (report-rules.test.ts).
import { lineAmount } from "@/lib/purchase/rules";

export type OrderLineFact = { id: string; orderedMilli: number; receivedMilli: number; rejectedMilli: number; rateMinor: number; gstBps: number };
export type OrderFact = {
  id: string; number: string; projectId: string; projectName: string; vendorId: string; vendorName: string;
  status: "DRAFT" | "SENT" | "PART_DELIVERED" | "DELIVERED" | "CLOSED" | "CANCELLED";
  orderDate: string; deliveryDate: string | null;
  /** The day the last item arrived (null while something is still to come). */
  deliveredOn: string | null;
  lines: OrderLineFact[];
  /** Bills (confirmed) linked to this order, with GST. */
  billedMinor: number;
};

const LIVE = new Set(["SENT", "PART_DELIVERED", "DELIVERED", "CLOSED"]);

export function orderValues(o: Pick<OrderFact, "status" | "lines">) {
  let totalMinor = 0;
  let receivedMinor = 0;
  for (const l of o.lines) {
    totalMinor += lineAmount(l.orderedMilli, l.rateMinor, l.gstBps).totalMinor;
    receivedMinor += lineAmount(l.receivedMilli, l.rateMinor, l.gstBps).totalMinor;
  }
  // A draft or cancelled order commits nothing. One closed short commits only what arrived (the rest is not coming).
  const committedMinor = !LIVE.has(o.status) ? 0 : o.status === "CLOSED" ? receivedMinor : totalMinor;
  return { totalMinor, receivedMinor, committedMinor };
}

/** The day by which every item had arrived in full, from the deliveries in date order. Null if some item never did. */
export function completionDate(lines: { id: string; orderedMilli: number }[], receipts: { receivedOn: string; lines: { orderLineId: string; quantityMilli: number }[] }[]): string | null {
  if (lines.length === 0) return null;
  const got: Record<string, number> = {};
  for (const r of [...receipts].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn))) {
    for (const l of r.lines) got[l.orderLineId] = (got[l.orderLineId] ?? 0) + l.quantityMilli;
    if (lines.every((l) => (got[l.id] ?? 0) >= l.orderedMilli)) return r.receivedOn;
  }
  return null;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ---- per project

export type ProjectInput = { id: string; name: string; budgetMinor: number | null; billedAllMinor: number; paidMinor: number };
export type ProjectRow = {
  id: string; name: string; orders: number;
  committedMinor: number; receivedMinor: number; billedOnOrdersMinor: number;
  /** Ordered but not yet delivered. */
  toDeliverMinor: number;
  /** Delivered but not yet billed: money the supplier will ask for. */
  awaitingBillMinor: number;
  billedAllMinor: number; paidMinor: number; outstandingMinor: number;
  /** What the project will have cost if everything ordered is billed: bills so far plus ordered-but-unbilled. */
  expectedMinor: number;
  budgetMinor: number | null; budgetStatus: "none" | "ok" | "warn" | "over";
};

export function projectRows(orders: OrderFact[], projects: ProjectInput[]): ProjectRow[] {
  return projects.map((p) => {
    const mine = orders.filter((o) => o.projectId === p.id && LIVE.has(o.status));
    let committed = 0, received = 0, billedOn = 0, unbilledCommitted = 0, awaiting = 0, toDeliver = 0;
    for (const o of mine) {
      const v = orderValues(o);
      committed += v.committedMinor;
      received += v.receivedMinor;
      billedOn += o.billedMinor;
      unbilledCommitted += Math.max(0, v.committedMinor - o.billedMinor);
      awaiting += Math.max(0, v.receivedMinor - o.billedMinor);
      toDeliver += Math.max(0, v.committedMinor - v.receivedMinor);
    }
    const expected = p.billedAllMinor + unbilledCommitted;
    const budgetStatus: ProjectRow["budgetStatus"] = p.budgetMinor === null || p.budgetMinor <= 0 ? "none" : expected > p.budgetMinor ? "over" : expected >= p.budgetMinor * 0.8 ? "warn" : "ok";
    return {
      id: p.id, name: p.name, orders: mine.length, committedMinor: committed, receivedMinor: received, billedOnOrdersMinor: billedOn, toDeliverMinor: toDeliver, awaitingBillMinor: awaiting,
      billedAllMinor: p.billedAllMinor, paidMinor: p.paidMinor, outstandingMinor: Math.max(0, p.billedAllMinor - p.paidMinor), expectedMinor: expected, budgetMinor: p.budgetMinor, budgetStatus,
    };
  });
}

// ---- per supplier

export type SupplierRow = {
  vendorId: string; name: string; orders: number; valueMinor: number;
  /** Orders with a delivery date that have been fully delivered, and how many of those were on or before it. */
  measured: number; onTime: number; onTimePercent: number | null; averageDelayDays: number | null;
  /** Quantity received against quantity ordered (orders closed short count what arrived). */
  fillPercent: number | null;
  /** Share of what arrived that was refused (damaged, wrong). */
  refusedPercent: number | null;
  /** Orders past their delivery date and still not complete. */
  lateOpen: number;
};

export function supplierRows(orders: OrderFact[], today: string): SupplierRow[] {
  const by = new Map<string, OrderFact[]>();
  for (const o of orders) if (LIVE.has(o.status)) by.set(o.vendorId, [...(by.get(o.vendorId) ?? []), o]);
  const rows: SupplierRow[] = [];
  for (const [vendorId, list] of by) {
    let value = 0, measured = 0, onTime = 0, delayTotal = 0, delayCount = 0, lateOpen = 0;
    let ordered = 0, received = 0, rejected = 0;
    for (const o of list) {
      value += orderValues(o).committedMinor;
      const complete = o.status === "DELIVERED" || (o.status === "CLOSED" && o.deliveredOn !== null);
      if (complete && o.deliveryDate && o.deliveredOn) {
        measured++;
        const late = daysBetween(o.deliveryDate, o.deliveredOn);
        if (late <= 0) onTime++;
        else {
          delayTotal += late;
          delayCount++;
        }
      }
      if ((o.status === "SENT" || o.status === "PART_DELIVERED") && o.deliveryDate && o.deliveryDate < today) lateOpen++;
      for (const l of o.lines) {
        // an order closed short is judged on what was ordered, so a supplier that stopped short shows a lower fill rate
        ordered += l.orderedMilli;
        received += l.receivedMilli;
        rejected += l.rejectedMilli;
      }
    }
    rows.push({
      vendorId, name: list[0].vendorName, orders: list.length, valueMinor: value, measured, onTime,
      onTimePercent: measured > 0 ? Math.round((onTime / measured) * 100) : null,
      averageDelayDays: delayCount > 0 ? Math.round((delayTotal / delayCount) * 10) / 10 : null,
      fillPercent: ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : null,
      refusedPercent: received + rejected > 0 ? Math.round((rejected / (received + rejected)) * 1000) / 10 : null,
      lateOpen,
    });
  }
  return rows.sort((a, b) => b.valueMinor - a.valueMinor || a.name.localeCompare(b.name));
}

// ---- open orders

export type OpenOrderRow = {
  id: string; number: string; projectName: string; vendorName: string; deliveryDate: string | null; status: OrderFact["status"];
  daysLate: number; receivedPercent: number; toDeliverMinor: number;
};

/** Orders sent and not yet complete, the late ones first (the most days late, then the nearest delivery date). */
export function openOrderRows(orders: OrderFact[], today: string): OpenOrderRow[] {
  return orders
    .filter((o) => o.status === "SENT" || o.status === "PART_DELIVERED")
    .map((o) => {
      const v = orderValues(o);
      const ordered = o.lines.reduce((s, l) => s + l.orderedMilli, 0);
      const got = o.lines.reduce((s, l) => s + Math.min(l.receivedMilli, l.orderedMilli), 0);
      return {
        id: o.id, number: o.number, projectName: o.projectName, vendorName: o.vendorName, deliveryDate: o.deliveryDate, status: o.status,
        daysLate: o.deliveryDate && o.deliveryDate < today ? daysBetween(o.deliveryDate, today) : 0,
        receivedPercent: ordered > 0 ? Math.round((got / ordered) * 100) : 0,
        toDeliverMinor: Math.max(0, v.committedMinor - v.receivedMinor),
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate || (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999") || a.number.localeCompare(b.number));
}

export type ReportTotals = { committedMinor: number; receivedMinor: number; awaitingBillMinor: number; toDeliverMinor: number; billedAllMinor: number; paidMinor: number; outstandingMinor: number; expectedMinor: number };
export const sumProjects = (rows: ProjectRow[]): ReportTotals =>
  rows.reduce<ReportTotals>(
    (t, r) => ({ committedMinor: t.committedMinor + r.committedMinor, receivedMinor: t.receivedMinor + r.receivedMinor, awaitingBillMinor: t.awaitingBillMinor + r.awaitingBillMinor, toDeliverMinor: t.toDeliverMinor + r.toDeliverMinor, billedAllMinor: t.billedAllMinor + r.billedAllMinor, paidMinor: t.paidMinor + r.paidMinor, outstandingMinor: t.outstandingMinor + r.outstandingMinor, expectedMinor: t.expectedMinor + r.expectedMinor }),
    { committedMinor: 0, receivedMinor: 0, awaitingBillMinor: 0, toDeliverMinor: 0, billedAllMinor: 0, paidMinor: 0, outstandingMinor: 0, expectedMinor: 0 },
  );
