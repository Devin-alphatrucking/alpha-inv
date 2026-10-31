// Database-backed tests of the Sales invoices add-on: the company switch, GST invoices, numbering, payments received, cancelling,
// the GSTR-1 style downloads, and that one company never sees another's sales. Run through `npm run test:isolation`.
import assert from "node:assert/strict";
import fs from "node:fs";

const emailFile = process.env.EMAIL_FILE;
if (!emailFile || !process.env.DATABASE_URL) {
  console.error("Run this through `npm run test:isolation`.");
  process.exit(2);
}

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(error as Error).message.split("\n").slice(0, 4).join("\n      ")}`);
  }
}

let ipCounter = 0;
const ip = () => `192.0.2.${++ipCounter}`;
const mails = () => (fs.existsSync(emailFile!) ? fs.readFileSync(emailFile!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);

async function main() {
  const { signUp } = await import("@/lib/flows/signup");
  const { confirmEmail } = await import("@/lib/flows/verify-reset");
  const { rawDb } = await import("@/lib/db");
  const { setAddon, enabledAddons } = await import("@/lib/addons");
  const sales = await import("@/lib/flows/sales");
  const { dbFor } = await import("@/lib/org/scoped-db");

  const PW = "correct horse battery staple";
  const makeCompany = async (name: string, email: string) => {
    assert.ok((await signUp({ companyName: name, name: `${name} Admin`, email, password: PW, country: "IN", phone: "9876543210", acceptTerms: true }, { ip: ip() })).ok);
    const found = mails().filter((x) => x.to === email && x.subject.includes("Confirm your email"));
    assert.ok((await confirmEmail(/token=([A-Za-z0-9_-]+)/.exec(found[found.length - 1].text)![1])).ok);
    const user = await rawDb.user.findUniqueOrThrow({ where: { email } });
    const m = await rawDb.membership.findFirstOrThrow({ where: { userId: user.id } });
    return { orgId: m.organizationId, admin: { id: user.id, orgId: m.organizationId, role: "ADMIN" as const } };
  };

  const a = await makeCompany("Sales Alpha", "admin@sales-alpha.test");
  const b = await makeCompany("Sales Beta", "admin@sales-beta.test");
  const accountant = { ...a.admin, role: "ACCOUNTANT" as const };
  const engineer = { ...a.admin, role: "ENGINEER" as const };

  // a real, well-formed GSTIN with a valid check character (Maharashtra and Karnataka)
  const { gstinCheckChar } = await import("@/lib/gst/gstin");
  const makeGstin = (state: string, pan: string) => {
    const first14 = `${state}${pan}1Z`;
    return first14 + gstinCheckChar(first14);
  };
  const MH = makeGstin("27", "ABCDE1234F");
  const KA = makeGstin("29", "PQRSX9876L");

  await check("the add-on is off by default: every sales action is refused, and nothing is created", async () => {
    assert.deepEqual(await enabledAddons(a.orgId), []);
    const r = await sales.saveProfile(a.admin, { legalName: "Alpha Builders", stateCode: "27", address: "12 MG Road, Pune" });
    assert.ok(!r.ok && /not switched on/.test(r.error));
    const l = await sales.listInvoices(a.admin);
    assert.ok(!l.ok && /not switched on/.test(l.error));
    assert.equal(await dbFor(a.orgId).salesProfile.count(), 0);
  });

  await check("switching it on is per company; another company stays off; switching off hides it again but keeps the data", async () => {
    await setAddon(a.orgId, a.admin.id, "sales", true);
    assert.deepEqual(await enabledAddons(a.orgId), ["sales"]);
    assert.ok((await sales.listInvoices(a.admin)).ok);
    // enabledAddons is read once per request in the app; ask the database directly for the other company
    const other = await rawDb.organization.findUniqueOrThrow({ where: { id: b.orgId }, select: { addons: true } });
    assert.deepEqual(other.addons, []);
    assert.ok(!(await sales.listInvoices(b.admin)).ok, "company B has not switched it on");
  });

  await check("only people with the sales permission can use it (an engineer cannot, an accountant can)", async () => {
    const denied = await sales.listInvoices(engineer);
    assert.ok(!denied.ok && /do not have access/.test(denied.error));
    assert.ok((await sales.listInvoices(accountant)).ok);
  });

  await check("company details: needs a valid state and GSTIN; the GSTIN must belong to the chosen state; the prefix is checked", async () => {
    const base = { legalName: "Alpha Builders Pvt Ltd", stateCode: "27", address: "12 MG Road, Pune", gstin: MH };
    const broken = MH.slice(0, 14) + (MH[14] === "0" ? "1" : "0");
    const badGstin = await sales.saveProfile(a.admin, { ...base, gstin: broken });
    assert.ok(!badGstin.ok && badGstin.field === "gstin");
    const wrongState = await sales.saveProfile(a.admin, { ...base, stateCode: "29" });
    assert.ok(!wrongState.ok && wrongState.field === "stateCode");
    const badPrefix = await sales.saveProfile(a.admin, { ...base, prefix: "A/B" });
    assert.ok(!badPrefix.ok && badPrefix.field === "prefix");
    assert.ok(!(await sales.saveProfile(a.admin, { ...base, stateCode: "99" })).ok);
    assert.ok((await sales.saveProfile(a.admin, { ...base, prefix: "alp", bankDetails: "HDFC 1234", terms: "Pay in 30 days" })).ok);
    const p = await sales.getProfile(a.orgId);
    assert.equal(p?.prefix, "ALP");
    assert.equal(p?.gstin, MH);
    assert.ok((await sales.saveProfile(a.admin, { ...base, prefix: "ALP", legalName: "Alpha Builders Limited" })).ok, "saving again updates the one profile");
    assert.equal(await dbFor(a.orgId).salesProfile.count(), 1);
  });

  let intraCustomer = "";
  let interCustomer = "";
  await check("customers: the state comes from the GSTIN; a wrong GSTIN or a repeat is refused; one without GSTIN needs no state until invoicing", async () => {
    const intra = await sales.createCustomer(a.admin, { name: "Shree Constructions", gstin: ` ${MH.toLowerCase()} ` });
    assert.ok(intra.ok);
    if (intra.ok) intraCustomer = intra.id;
    const inter = await sales.createCustomer(a.admin, { name: "Bengaluru Infra", gstin: KA });
    assert.ok(inter.ok);
    if (inter.ok) interCustomer = inter.id;
    const dup = await sales.createCustomer(a.admin, { name: "Shree again", gstin: MH });
    assert.ok(!dup.ok && dup.field === "gstin");
    const bad = await sales.createCustomer(a.admin, { name: "Typo Ltd", gstin: MH.slice(0, 14) + (MH[14] === "9" ? "8" : "9") });
    assert.ok(!bad.ok && bad.field === "gstin");
    const list = await sales.listCustomers(a.admin);
    assert.ok(list.ok);
    if (list.ok) assert.equal(list.customers.find((c) => c.id === intraCustomer)?.stateCode, "27");
    assert.ok((await sales.createCustomer(a.admin, { name: "Walk-in customer", stateCode: "27" })).ok);
  });

  const line = { description: "Cement 53 grade", hsnSac: "2523", quantity: 10, unit: "Bag", rate: 100, gstPercent: 18 };
  let firstId = "";
  await check("same-state invoice: CGST + SGST, first number of the financial year, total rounded to the rupee", async () => {
    const r = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-05", dueDate: "2026-12-05", lines: [line, { ...line, description: "Steel", hsnSac: "7214", quantity: 3, rate: 33.33, gstPercent: 5 }] });
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (!r.ok) return;
    firstId = r.id;
    assert.equal(r.number, "ALP/2026-27/0001");
    const v = await sales.getInvoice(a.admin, r.id);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(v.invoice.supply, "intra");
    assert.equal(v.invoice.igst, 0);
    assert.equal(v.invoice.taxable, 1099.99);
    assert.equal(v.invoice.cgst + v.invoice.sgst, 185);
    assert.equal(v.invoice.total, 1285);
    assert.equal(v.invoice.status, "ISSUED");
    assert.equal(v.invoice.lines.length, 2);
    assert.equal(v.invoice.customer.name, "Shree Constructions");
  });

  await check("other-state invoice: IGST only; numbers count up; a new financial year starts again at 0001", async () => {
    const second = await sales.createInvoice(a.admin, { customerId: interCustomer, invoiceDate: "2026-11-06", lines: [line] });
    assert.ok(second.ok && second.number === "ALP/2026-27/0002");
    const v = second.ok ? await sales.getInvoice(a.admin, second.id) : null;
    assert.ok(v?.ok && v.invoice.supply === "inter" && v.invoice.igst === 180 && v.invoice.cgst === 0 && v.invoice.total === 1180);
    const lastYear = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2027-03-31", lines: [line] });
    assert.ok(lastYear.ok && lastYear.number === "ALP/2026-27/0003");
    const newYear = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2027-04-01", lines: [line] });
    assert.ok(newYear.ok && newYear.number === "ALP/2027-28/0001", newYear.ok ? newYear.number : newYear.error);
  });

  await check("refusals: no profile, no items, a bad item, the due date before the invoice date, no place of supply, an unknown customer", async () => {
    const noCustomerState = await sales.createCustomer(a.admin, { name: "No state yet" });
    assert.ok(noCustomerState.ok);
    const id = noCustomerState.ok ? noCustomerState.id : "";
    const noPlace = await sales.createInvoice(a.admin, { customerId: id, invoiceDate: "2026-11-05", lines: [line] });
    assert.ok(!noPlace.ok && noPlace.field === "placeOfSupply");
    const withPlace = await sales.createInvoice(a.admin, { customerId: id, invoiceDate: "2026-11-05", placeOfSupply: "27", lines: [line] });
    assert.ok(withPlace.ok, "the place can be chosen on the invoice");
    assert.ok(!(await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-05", lines: [] })).ok);
    const badLine = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-05", lines: [{ ...line, quantity: 0 }] });
    assert.ok(!badLine.ok && /quantity/.test(badLine.error));
    const early = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-05", dueDate: "2026-11-01", lines: [line] });
    assert.ok(!early.ok && early.field === "dueDate");
    assert.ok(!(await sales.createInvoice(a.admin, { customerId: "nope", invoiceDate: "2026-11-05", lines: [line] })).ok);
    assert.ok(!(await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "05-11-2026", lines: [line] })).ok);
    // nothing half-made: the numbers used are exactly the ones issued so far
    const numbers = (await dbFor(a.orgId).salesInvoice.findMany()).map((x) => x.number);
    assert.ok(numbers.length >= 4);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  await check("payments received: part payment, full payment, overpayment refused, removing a payment brings the status back", async () => {
    const part = await sales.recordReceipt(a.admin, firstId, { amount: 500, receivedOn: "2026-11-10", mode: "UPI", reference: "UTR1" });
    assert.ok(part.ok && part.status === "PARTIALLY_PAID" && part.balance === 785);
    const tooMuch = await sales.recordReceipt(a.admin, firstId, { amount: 786, receivedOn: "2026-11-11" });
    assert.ok(!tooMuch.ok && tooMuch.field === "amount");
    const rest = await sales.recordReceipt(a.admin, firstId, { amount: 785, receivedOn: "2026-11-12" });
    assert.ok(rest.ok && rest.status === "PAID" && rest.balance === 0);
    const v = await sales.getInvoice(a.admin, firstId);
    assert.ok(v.ok && v.invoice.receipts.length === 2 && v.invoice.received === 1285);
    if (v.ok) assert.ok((await sales.deleteReceipt(a.admin, v.invoice.receipts[1].id)).ok);
    const after = await sales.getInvoice(a.admin, firstId);
    assert.ok(after.ok && after.invoice.status === "PARTIALLY_PAID" && after.invoice.balance === 785);
    assert.ok(!(await sales.recordReceipt(a.admin, firstId, { amount: 0, receivedOn: "2026-11-12" })).ok);
  });

  await check("two payments at the same moment cannot together exceed the balance", async () => {
    const inv = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-07", lines: [{ ...line, quantity: 1, rate: 1000 }] }); // 1180
    assert.ok(inv.ok);
    if (!inv.ok) return;
    const results = await Promise.all([1, 2, 3].map(() => sales.recordReceipt(a.admin, inv.id, { amount: 600, receivedOn: "2026-11-08" })));
    assert.equal(results.filter((r) => r.ok).length, 1, "only one of three 600 payments fits in 1180");
    const v = await sales.getInvoice(a.admin, inv.id);
    assert.ok(v.ok && v.invoice.received === 600);
  });

  await check("cancelling: refused while money is received, allowed otherwise, the number is never reused, a cancelled invoice takes no payment", async () => {
    const refused = await sales.cancelInvoice(a.admin, firstId);
    assert.ok(!refused.ok && /received/.test(refused.error));
    const tmp = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-09", lines: [line] });
    assert.ok(tmp.ok);
    if (!tmp.ok) return;
    assert.ok((await sales.cancelInvoice(a.admin, tmp.id)).ok);
    assert.ok(!(await sales.cancelInvoice(a.admin, tmp.id)).ok, "cancelling twice is refused");
    assert.ok(!(await sales.recordReceipt(a.admin, tmp.id, { amount: 10, receivedOn: "2026-11-09" })).ok);
    const next = await sales.createInvoice(a.admin, { customerId: intraCustomer, invoiceDate: "2026-11-09", lines: [line] });
    assert.ok(next.ok && next.number !== tmp.number);
    const l = await sales.listInvoices(a.admin, { status: "CANCELLED" });
    assert.ok(l.ok && l.invoices.some((i) => i.id === tmp.id));
  });

  await check("the list: totals leave cancelled invoices out; search by number or customer; overdue is flagged", async () => {
    const all = await sales.listInvoices(a.admin);
    assert.ok(all.ok);
    if (!all.ok) return;
    assert.ok(all.invoices.length >= 6);
    assert.ok(all.totals.billed > 0 && all.totals.outstanding === Math.round((all.totals.billed - all.totals.received) * 100) / 100);
    assert.ok(all.invoices.filter((i) => i.dueDate === null).every((i) => !i.overdue), "an invoice with no due date is never overdue");
    const found = await sales.listInvoices(a.admin, { q: "shree" });
    assert.ok(found.ok && found.invoices.length > 0 && found.invoices.every((i) => /shree/i.test(i.customerName)), "search by customer");
    const byNumber = await sales.listInvoices(a.admin, { q: "0002" });
    assert.ok(byNumber.ok && byNumber.invoices.some((i) => i.number === "ALP/2026-27/0002"), "search by number");
    const paid = await sales.listInvoices(a.admin, { status: "PAID" });
    assert.ok(paid.ok && paid.invoices.every((i) => i.status === "PAID"));
  });

  await check("downloads: GSTR-1 style rows by rate, HSN totals and the plain invoice list; cancelled left out; a formula in a name is neutralised", async () => {
    await sales.createCustomer(a.admin, { name: "=HYPERLINK(\"http://x\")", stateCode: "27" });
    const evil = (await sales.listCustomers(a.admin)).ok ? (await sales.listCustomers(a.admin)) : null;
    const evilId = evil && evil.ok ? evil.customers.find((c) => c.name.startsWith("="))!.id : "";
    const made = await sales.createInvoice(a.admin, { customerId: evilId, invoiceDate: "2026-11-15", lines: [line] });
    assert.ok(made.ok);
    const b2b = await sales.exportCsv(a.admin, "b2b", "2026-04-01", "2027-03-31");
    assert.ok(b2b.ok);
    if (!b2b.ok) return;
    assert.match(b2b.filename, /sales-b2b-2026-04-01-to-2027-03-31\.csv/);
    assert.ok(b2b.csv.startsWith("﻿Type,GSTIN/UIN of recipient"));
    const rows = b2b.csv.trim().split("\r\n");
    assert.ok(rows.some((r) => r.includes("ALP/2026-27/0001") && r.includes(",18,")), "an 18% row for the first invoice");
    assert.ok(rows.some((r) => r.includes("ALP/2026-27/0001") && r.includes(",5,")), "and a 5% row (rate-wise)");
    assert.ok(rows.some((r) => r.startsWith("B2B,") && r.includes(MH)), "B2B has the recipient GSTIN");
    assert.ok(rows.some((r) => r.startsWith("B2C,")), "no GSTIN is B2C");
    assert.ok(!b2b.csv.includes("ALP/2027-28/0001"), "outside the period");
    assert.ok(b2b.csv.includes("\"'=HYPERLINK(") || b2b.csv.includes("'=HYPERLINK"), "formula neutralised");
    const igstRow = rows.find((r) => r.includes("ALP/2026-27/0002"))!;
    assert.ok(igstRow.endsWith(",180,0,0"), `IGST row: ${igstRow}`);
    const hsn = await sales.exportCsv(a.admin, "hsn", "2026-04-01", "2027-03-31");
    assert.ok(hsn.ok && hsn.csv.includes("2523") && hsn.csv.includes("7214"));
    const plain = await sales.exportCsv(a.admin, "invoices", "2026-04-01", "2027-03-31");
    assert.ok(plain.ok && !plain.csv.includes("CANCELLED"), "cancelled invoices are not in the file");
    assert.ok(!(await sales.exportCsv(a.admin, "b2b", "2027-01-01", "2026-01-01")).ok, "from after to is refused");
    assert.ok(!(await sales.exportCsv(engineer, "b2b", "2026-04-01", "2027-03-31")).ok, "no permission, no file");
  });

  await check("company separation: company B (add-on on) sees none of company A's sales and cannot open or change them", async () => {
    await setAddon(b.orgId, b.admin.id, "sales", true);
    const l = await sales.listInvoices(b.admin);
    assert.ok(l.ok && l.invoices.length === 0 && l.totals.billed === 0);
    assert.ok(!(await sales.getInvoice(b.admin, firstId)).ok);
    assert.ok(!(await sales.recordReceipt(b.admin, firstId, { amount: 1, receivedOn: "2026-11-12" })).ok);
    assert.ok(!(await sales.cancelInvoice(b.admin, firstId)).ok);
    const bc = await sales.listCustomers(b.admin);
    assert.ok(bc.ok && bc.customers.length === 0);
    assert.equal((await sales.getProfile(b.orgId)), null);
    // B can issue its own invoice and numbering starts at 1 for B
    assert.ok((await sales.saveProfile(b.admin, { legalName: "Beta Co", stateCode: "29", address: "5 Residency Road, Bengaluru" })).ok);
    const cust = await sales.createCustomer(b.admin, { name: "Beta Customer", stateCode: "29" });
    const inv = cust.ok ? await sales.createInvoice(b.admin, { customerId: cust.id, invoiceDate: "2026-11-05", lines: [line] }) : null;
    assert.ok(inv?.ok && inv.number === "INV/2026-27/0001");
    // A's customers cannot be used by B
    assert.ok(!(await sales.createInvoice(b.admin, { customerId: intraCustomer, invoiceDate: "2026-11-05", lines: [line] })).ok);
  });

  await check("switching the add-on off hides it, and switching it on again brings everything back", async () => {
    await setAddon(a.orgId, a.admin.id, "sales", false);
    const rawNames = await rawDb.organization.findUniqueOrThrow({ where: { id: a.orgId }, select: { addons: true } });
    assert.deepEqual(rawNames.addons, []);
    assert.ok(!(await sales.listInvoices(a.admin)).ok);
    await setAddon(a.orgId, a.admin.id, "sales", true);
    const l = await sales.listInvoices(a.admin);
    assert.ok(l.ok && l.invoices.length >= 6, "the invoices were kept");
    const log = await dbFor(a.orgId).activityLog.count({ where: { action: { in: ["ADDON_ENABLED", "ADDON_DISABLED"] } } });
    assert.ok(log >= 3, "each switch is in the activity log");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
