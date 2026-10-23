// Run with: npm run test:unit (from the repo root)
import assert from "node:assert/strict";
import { paymentModeLabel } from "./payment-mode";
import { computeStatus, isPastDue, remainingMinor, round2, todayIn, toMinor } from "./status";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// ---- rounding and minor units
assert.equal(round2(1.005), 1.01);
assert.equal(round2(0.1 + 0.2), 0.3);
assert.equal(toMinor(0.1 + 0.2), 30);
assert.equal(toMinor(1234.565), 123457);

// ---- today in a zone
const t = new Date("2026-10-22T20:00:00Z"); // 01:30 on the 23rd in India, 07:00 on the 23rd in Sydney, 22 Oct in New York
assert.equal(todayIn("Asia/Kolkata", t), "2026-10-23");
assert.equal(todayIn("Australia/Sydney", t), "2026-10-23");
assert.equal(todayIn("America/New_York", t), "2026-10-22");
assert.equal(todayIn("UTC", t), "2026-10-22");
assert.equal(todayIn("Not/AZone", t), "2026-10-22", "a bad zone falls back to UTC instead of throwing");
assert.equal(todayIn(null, t), "2026-10-22");

// ---- past due: the whole due day must pass, in the company's zone
assert.equal(isPastDue(d("2026-10-23"), "Australia/Sydney", new Date("2026-10-22T20:00:00Z")), false, "due today is not overdue");
assert.equal(isPastDue(d("2026-10-22"), "Australia/Sydney", new Date("2026-10-22T20:00:00Z")), true, "it is already the 23rd in Sydney");
assert.equal(isPastDue(d("2026-10-22"), "America/New_York", new Date("2026-10-22T20:00:00Z")), false, "still the 22nd in New York");
assert.equal(isPastDue(null, "UTC"), false);
assert.equal(isPastDue(new Date("garbage"), "UTC"), false);

// ---- status
const now = new Date("2026-10-23T06:00:00Z");
const base = { total: 1000, dueDate: d("2026-11-30"), timeZone: "Asia/Kolkata", now };
assert.equal(computeStatus({ ...base, paid: 0 }), "UNPAID");
assert.equal(computeStatus({ ...base, paid: 400 }), "PARTIALLY_PAID");
assert.equal(computeStatus({ ...base, paid: 1000 }), "PAID");
assert.equal(computeStatus({ ...base, paid: 999.99 }), "PAID", "one paise of slack");
assert.equal(computeStatus({ ...base, paid: 999.98 }), "PARTIALLY_PAID");
assert.equal(computeStatus({ ...base, paid: 1200 }), "PAID", "overpaid is paid");
assert.equal(computeStatus({ ...base, total: 0.3, paid: 0.1 + 0.2 }), "PAID", "floating point does not break equality");
const late = { ...base, dueDate: d("2026-10-01") };
assert.equal(computeStatus({ ...late, paid: 0 }), "OVERDUE");
assert.equal(computeStatus({ ...late, paid: 400 }), "OVERDUE", "part paid but past due is overdue");
assert.equal(computeStatus({ ...late, paid: 1000 }), "PAID", "paid wins over past due");
assert.equal(computeStatus({ ...base, dueDate: null, paid: 0 }), "UNPAID");
assert.equal(computeStatus({ ...base, total: 0, paid: 0 }), "PAID", "a zero invoice owes nothing");

// ---- remaining balance
assert.equal(remainingMinor(1000, 250.5), 74950);
assert.equal(remainingMinor(1000, 1000), 0);
assert.equal(remainingMinor(1000, 1500), 0);

// ---- payment mode labels
assert.equal(paymentModeLabel("BANK_TRANSFER"), "Bank transfer");
assert.equal(paymentModeLabel("Bank transfer"), "Bank transfer");
assert.equal(paymentModeLabel("NEFT"), "NEFT");
assert.equal(paymentModeLabel("UPI"), "UPI");
assert.equal(paymentModeLabel(null), "Other");
assert.equal(paymentModeLabel("  "), "Other");

console.log("invoice status: all checks passed");
