// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { completionDate, openOrderRows, orderValues, projectRows, sumProjects, supplierRows, type OrderFact } from "./report-rules";

const TODAY = "2026-10-27";
// 40 bags at 380.00 + 18% = 17,936.00 ; 1000 kg at 65.00 + 18% = 76,700.00
const line = (id: string, ordered: number, received: number, rate: number, rejected = 0) => ({ id, orderedMilli: ordered * 1000, receivedMilli: received * 1000, rejectedMilli: rejected * 1000, rateMinor: rate * 100, gstBps: 1800 });
const order = (o: Partial<OrderFact> & { id: string }): OrderFact => ({
  number: o.id.toUpperCase(), projectId: "p1", projectName: "Tower A", vendorId: "v1", vendorName: "Shree Cement", status: "SENT", orderDate: "2026-10-01", deliveryDate: "2026-10-20", deliveredOn: null,
  lines: [line("a", 40, 0, 380)], billedMinor: 0, ...o,
});

// ---- order values
assert.deepEqual(orderValues({ status: "SENT", lines: [line("a", 40, 30, 380)] }), { totalMinor: 1_793_600, receivedMinor: 1_345_200, committedMinor: 1_793_600 });
assert.equal(orderValues({ status: "DRAFT", lines: [line("a", 40, 0, 380)] }).committedMinor, 0, "a draft commits nothing");
assert.equal(orderValues({ status: "CANCELLED", lines: [line("a", 40, 0, 380)] }).committedMinor, 0);
assert.equal(orderValues({ status: "CLOSED", lines: [line("a", 40, 30, 380)] }).committedMinor, 1_345_200, "closed short commits only what arrived");
assert.equal(orderValues({ status: "DELIVERED", lines: [line("a", 40, 40, 380)] }).committedMinor, 1_793_600);

// ---- when an order was complete
const ls = [{ id: "a", orderedMilli: 40000 }, { id: "b", orderedMilli: 10000 }];
assert.equal(completionDate(ls, [{ receivedOn: "2026-10-05", lines: [{ orderLineId: "a", quantityMilli: 40000 }] }, { receivedOn: "2026-10-09", lines: [{ orderLineId: "b", quantityMilli: 10000 }] }]), "2026-10-09");
assert.equal(completionDate(ls, [{ receivedOn: "2026-10-09", lines: [{ orderLineId: "b", quantityMilli: 10000 }] }, { receivedOn: "2026-10-05", lines: [{ orderLineId: "a", quantityMilli: 40000 }] }]), "2026-10-09", "order of the list does not matter, the dates do");
assert.equal(completionDate(ls, [{ receivedOn: "2026-10-05", lines: [{ orderLineId: "a", quantityMilli: 40000 }] }]), null, "an item never came");
assert.equal(completionDate(ls, [{ receivedOn: "2026-10-05", lines: [{ orderLineId: "a", quantityMilli: 20000 }] }, { receivedOn: "2026-10-06", lines: [{ orderLineId: "a", quantityMilli: 20000 }, { orderLineId: "b", quantityMilli: 12000 }] }]), "2026-10-06", "part deliveries add up, over-delivery is fine");
assert.equal(completionDate([], []), null);

// ---- projects
const orders: OrderFact[] = [
  order({ id: "o1", status: "DELIVERED", lines: [line("a", 40, 40, 380)], billedMinor: 1_793_600, deliveredOn: "2026-10-18" }), // delivered and fully billed
  order({ id: "o2", status: "PART_DELIVERED", lines: [line("a", 100, 60, 100)], billedMinor: 0 }), // 11,800 + ... see below
  order({ id: "o3", status: "DRAFT", lines: [line("a", 10, 0, 1000)] }),
  order({ id: "o4", status: "CANCELLED", lines: [line("a", 10, 0, 1000)] }),
  order({ id: "o5", projectId: "p2", projectName: "Tower B", status: "SENT", lines: [line("a", 10, 0, 500)] }),
];
const rows = projectRows(orders, [
  { id: "p1", name: "Tower A", budgetMinor: 5_000_000, billedAllMinor: 1_793_600, paidMinor: 1_000_000 },
  { id: "p2", name: "Tower B", budgetMinor: null, billedAllMinor: 0, paidMinor: 0 },
  { id: "p3", name: "Empty", budgetMinor: 100, billedAllMinor: 0, paidMinor: 0 },
]);
const a = rows[0];
// o2: 100 x 100.00 + 18% = 11,800.00 ordered ; 60 received = 7,080.00
assert.equal(a.orders, 2, "drafts and cancelled orders are not counted");
assert.equal(a.committedMinor, 1_793_600 + 1_180_000);
assert.equal(a.receivedMinor, 1_793_600 + 708_000);
assert.equal(a.billedOnOrdersMinor, 1_793_600);
assert.equal(a.toDeliverMinor, 1_180_000 - 708_000, "ordered and not yet delivered");
assert.equal(a.awaitingBillMinor, 708_000, "delivered and not yet billed");
assert.equal(a.outstandingMinor, 793_600, "billed less paid");
assert.equal(a.expectedMinor, 1_793_600 + 1_180_000, "bills so far plus what is ordered and not billed");
assert.equal(a.budgetStatus, "ok");
assert.equal(rows[1].committedMinor, 590_000);
assert.equal(rows[1].budgetStatus, "none");
assert.equal(rows[2].orders, 0);
assert.equal(rows[2].budgetStatus, "ok", "no orders and no bills: nothing spent of a small budget");
assert.equal(projectRows(orders, [{ id: "p1", name: "T", budgetMinor: 2_500_000, billedAllMinor: 1_793_600, paidMinor: 0 }])[0].budgetStatus, "over", "bills plus what is ordered pass the budget");
assert.equal(projectRows(orders, [{ id: "p1", name: "T", budgetMinor: 3_300_000, billedAllMinor: 1_793_600, paidMinor: 0 }])[0].budgetStatus, "warn", "within 20% of the budget");
assert.equal(projectRows(orders, [{ id: "p1", name: "T", budgetMinor: 0, billedAllMinor: 1, paidMinor: 0 }])[0].budgetStatus, "none", "a zero budget means none");
const t = sumProjects(rows);
assert.equal(t.committedMinor, 1_793_600 + 1_180_000 + 590_000);
assert.equal(t.billedAllMinor, 1_793_600);

// ---- suppliers
const sup = supplierRows(
  [
    order({ id: "s1", status: "DELIVERED", deliveryDate: "2026-10-10", deliveredOn: "2026-10-09", lines: [line("a", 40, 40, 380)] }), // on time
    order({ id: "s2", status: "DELIVERED", deliveryDate: "2026-10-10", deliveredOn: "2026-10-14", lines: [line("a", 40, 40, 380)] }), // 4 days late
    order({ id: "s3", status: "CLOSED", deliveryDate: "2026-10-10", deliveredOn: null, lines: [line("a", 40, 30, 380, 2)] }), // closed short: counts for fill, not for timing
    order({ id: "s4", status: "SENT", deliveryDate: "2026-10-20", lines: [line("a", 10, 0, 100)] }), // 7 days late and open
    order({ id: "s5", status: "DRAFT" }),
    order({ id: "x1", vendorId: "v2", vendorName: "Another", status: "DELIVERED", deliveryDate: null, deliveredOn: "2026-10-09", lines: [line("a", 10, 10, 100)] }),
  ],
  TODAY,
);
const s = sup.find((r) => r.vendorId === "v1")!;
assert.equal(s.orders, 4, "the draft is not counted");
assert.deepEqual([s.measured, s.onTime, s.onTimePercent, s.averageDelayDays], [2, 1, 50, 4]);
assert.equal(s.lateOpen, 1);
assert.equal(s.fillPercent, Math.round(((40 + 40 + 30 + 0) / (40 + 40 + 40 + 10)) * 100));
assert.equal(s.refusedPercent, Math.round((2 / (110 + 2)) * 1000) / 10);
const other = sup.find((r) => r.vendorId === "v2")!;
assert.deepEqual([other.measured, other.onTimePercent, other.averageDelayDays, other.fillPercent], [0, null, null, 100], "no delivery date: nothing to measure on time");
assert.equal(sup[0].vendorId, "v1", "biggest value first");

// ---- open orders
const open = openOrderRows(
  [
    order({ id: "q1", status: "SENT", deliveryDate: "2026-10-25", lines: [line("a", 10, 0, 100)] }),
    order({ id: "q2", status: "PART_DELIVERED", deliveryDate: "2026-10-01", lines: [line("a", 10, 5, 100)] }),
    order({ id: "q3", status: "SENT", deliveryDate: "2026-11-05", lines: [line("a", 10, 0, 100)] }),
    order({ id: "q4", status: "SENT", deliveryDate: null, lines: [line("a", 10, 0, 100)] }),
    order({ id: "q5", status: "DELIVERED", deliveryDate: "2026-10-01", lines: [line("a", 10, 10, 100)] }),
  ],
  TODAY,
);
assert.deepEqual(open.map((r) => r.number), ["Q2", "Q1", "Q3", "Q4"], "most days late first, then nearest date, no date last; delivered orders are not open");
assert.deepEqual([open[0].daysLate, open[0].receivedPercent, open[0].toDeliverMinor], [26, 50, 59_000]);
assert.equal(open[2].daysLate, 0);

console.log("report rules: all checks passed");
