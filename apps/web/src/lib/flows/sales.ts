import { z } from "zod";
import { dbFor } from "@/lib/org/scoped-db";
import { logActivity } from "@/lib/activity";
import { hasPermission, type RoleName } from "@/lib/roles";
import { isAddonOn } from "@/lib/addons";
import { checkGstin, cleanGstin, GST_STATES, hasValue } from "@/lib/gst/gstin";
import { cleanPrefix, computeInvoice, csvCell, financialYear, invoiceNumber, isOverdue, statusFromReceipts, toPaise, type SalesStatus } from "@/lib/sales/rules";
import { companyToday } from "@/lib/flows/site";
import type { FlowResult } from "@/lib/flows/schemas";

/**
 * The Sales invoices add-on: the company's details, its customers, GST tax invoices, payments received and the GSTR-1 style downloads.
 * Standalone: it reads and writes only the Sales tables. Every function checks that the company switched the add-on on and that the
 * person holds the permission, so a page or a request that skips the menu still cannot use it.
 */

export type SalesUser = { id: string; orgId: string; role: RoleName };

const DENIED = "You do not have access to sales invoices.";
const OFF = "Sales invoices is not switched on for this company. An administrator can switch it on under Settings, Add-on modules.";

async function gate(user: SalesUser, need: "sales:view" | "sales:write"): Promise<string | null> {
  if (!hasPermission(user.role, need)) return DENIED;
  if (!(await isAddonOn(user.orgId, "sales"))) return OFF;
  return null;
}

const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as year-month-day.").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "That is not a real date.");
const asDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const clean = (v: string | undefined | null) => (v?.trim() ? v.trim() : null);
const num = (d: { toString(): string }) => Number(d.toString());

// ------------------------------------------------------------------ company details

export type Profile = { legalName: string; gstin: string | null; stateCode: string; address: string; phone: string | null; email: string | null; bankDetails: string | null; terms: string | null; prefix: string };

export async function getProfile(orgId: string): Promise<Profile | null> {
  const p = await dbFor(orgId).salesProfile.findFirst();
  return p ? { legalName: p.legalName, gstin: p.gstin, stateCode: p.stateCode, address: p.address, phone: p.phone, email: p.email, bankDetails: p.bankDetails, terms: p.terms, prefix: p.prefix } : null;
}

const profileSchema = z.object({
  legalName: z.string().trim().min(2, "Enter your company's name as it should print on invoices.").max(120),
  gstin: z.string().max(30).optional(),
  stateCode: z.string().regex(/^\d{2}$/, "Choose your state."),
  address: z.string().trim().min(5, "Enter your address.").max(300),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
  bankDetails: z.string().trim().max(400).optional(),
  terms: z.string().trim().max(600).optional(),
  prefix: z.string().max(20).optional(),
});

export async function saveProfile(user: SalesUser, raw: unknown): Promise<FlowResult> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form.", field: parsed.error.issues[0]?.path?.[0] as string | undefined };
  const v = parsed.data;
  if (!GST_STATES[v.stateCode]) return { ok: false, error: "Choose your state.", field: "stateCode" };
  let gstin: string | null = null;
  if (hasValue(v.gstin)) {
    const check = checkGstin(v.gstin);
    if (!check.ok) return { ok: false, error: check.reason, field: "gstin" };
    gstin = cleanGstin(v.gstin!);
    if (gstin.slice(0, 2) !== v.stateCode) return { ok: false, error: `Your GSTIN starts with ${gstin.slice(0, 2)} (${GST_STATES[gstin.slice(0, 2)]}), so your state must be that one.`, field: "stateCode" };
  }
  const prefix = cleanPrefix(v.prefix || "INV");
  if (!prefix) return { ok: false, error: "The invoice prefix is letters and digits only, up to 8 (for example INV).", field: "prefix" };
  const data = { legalName: v.legalName, gstin, stateCode: v.stateCode, address: v.address, phone: clean(v.phone), email: clean(v.email), bankDetails: clean(v.bankDetails), terms: clean(v.terms), prefix };
  const db = dbFor(user.orgId);
  const existing = await db.salesProfile.findFirst({ select: { id: true } });
  if (existing) await db.salesProfile.update({ where: { id: existing.id }, data });
  else await db.salesProfile.create({ data: { organizationId: user.orgId, ...data } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_PROFILE_SAVED", module: "SALES", entityId: user.orgId, details: { prefix } });
  return { ok: true };
}

// ------------------------------------------------------------------ customers

export type CustomerRow = { id: string; name: string; gstin: string | null; stateCode: string | null; address: string | null; phone: string | null; email: string | null; invoiceCount: number };

export async function listCustomers(user: SalesUser): Promise<FlowResult<{ customers: CustomerRow[] }>> {
  const denied = await gate(user, "sales:view");
  if (denied) return { ok: false, error: denied };
  const rows = await dbFor(user.orgId).salesCustomer.findMany({ orderBy: { name: "asc" }, take: 500, include: { _count: { select: { invoices: true } } } });
  return { ok: true, customers: rows.map((c) => ({ id: c.id, name: c.name, gstin: c.gstin, stateCode: c.stateCode, address: c.address, phone: c.phone, email: c.email, invoiceCount: c._count.invoices })) };
}

const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  gstin: z.string().max(30).optional(),
  stateCode: z.string().max(2).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
});

export async function createCustomer(user: SalesUser, raw: unknown): Promise<FlowResult<{ id: string }>> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form.", field: parsed.error.issues[0]?.path?.[0] as string | undefined };
  const v = parsed.data;
  let gstin: string | null = null;
  let stateCode = v.stateCode && /^\d{2}$/.test(v.stateCode) ? v.stateCode : null;
  if (hasValue(v.gstin)) {
    const check = checkGstin(v.gstin);
    if (!check.ok) return { ok: false, error: check.reason, field: "gstin" };
    gstin = cleanGstin(v.gstin!);
    stateCode = gstin.slice(0, 2); // the first two digits of a GSTIN are the state
  }
  if (stateCode && !GST_STATES[stateCode]) return { ok: false, error: "Choose the customer's state.", field: "stateCode" };
  const db = dbFor(user.orgId);
  if (gstin && (await db.salesCustomer.findFirst({ where: { gstin }, select: { id: true } }))) return { ok: false, error: "A customer with this GSTIN already exists.", field: "gstin" };
  const created = await db.salesCustomer.create({ data: { organizationId: user.orgId, name: v.name, gstin, stateCode, address: clean(v.address), phone: clean(v.phone), email: clean(v.email) }, select: { id: true } });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_CUSTOMER_CREATED", module: "SALES", entityId: created.id, details: { name: v.name } });
  return { ok: true, id: created.id };
}

// ------------------------------------------------------------------ invoices

const lineSchema = z.object({
  description: z.string(),
  hsnSac: z.string().optional().nullable(),
  quantity: z.coerce.number(),
  unit: z.string(),
  rate: z.coerce.number(),
  discountPercent: z.coerce.number().optional(),
  gstPercent: z.coerce.number(),
});
const invoiceSchema = z.object({
  customerId: z.string().min(1, "Choose the customer."),
  invoiceDate: day,
  dueDate: day.optional().nullable().or(z.literal("")),
  placeOfSupply: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(lineSchema).max(200),
});

export async function createInvoice(user: SalesUser, raw: unknown): Promise<FlowResult<{ id: string; number: string }>> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const parsed = invoiceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the invoice.", field: parsed.error.issues[0]?.path?.[0] as string | undefined };
  const v = parsed.data;
  const db = dbFor(user.orgId);
  const profile = await getProfile(user.orgId);
  if (!profile) return { ok: false, error: "Set up your company details first (Sales, Settings) so they can print on the invoice.", field: "profile" };
  const customer = await db.salesCustomer.findFirst({ where: { id: v.customerId } });
  if (!customer) return { ok: false, error: "Choose the customer.", field: "customerId" };
  const placeOfSupply = v.placeOfSupply && /^\d{2}$/.test(v.placeOfSupply) ? v.placeOfSupply : customer.stateCode;
  if (!placeOfSupply || !GST_STATES[placeOfSupply]) return { ok: false, error: "Choose the place of supply (the customer's state).", field: "placeOfSupply" };
  const dueDate = v.dueDate ? v.dueDate : null;
  if (dueDate && dueDate < v.invoiceDate) return { ok: false, error: "The due date cannot be before the invoice date.", field: "dueDate" };

  const totals = computeInvoice({ lines: v.lines, sellerState: profile.stateCode, placeOfSupply });
  if (!totals.ok) return { ok: false, error: totals.error, field: "lines" };
  const fy = financialYear(v.invoiceDate);

  const created = await db.$transaction(async (tx) => {
    const rows = await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<{ last: number }[]> }).$queryRaw`
      INSERT INTO "DocumentCounter" (id, "organizationId", kind, year, last)
      VALUES (gen_random_uuid()::text, ${user.orgId}, 'SI', ${fy.start}, 1)
      ON CONFLICT ("organizationId", kind, year) DO UPDATE SET last = "DocumentCounter".last + 1
      RETURNING last`;
    const number = invoiceNumber(profile.prefix, fy.label, Number(rows[0].last));
    const invoice = await tx.salesInvoice.create({
      data: {
        organizationId: user.orgId,
        number,
        customerId: customer.id,
        customerName: customer.name,
        customerGstin: customer.gstin,
        customerAddress: customer.address,
        placeOfSupply,
        invoiceDate: asDate(v.invoiceDate),
        dueDate: dueDate ? asDate(dueDate) : null,
        status: "ISSUED",
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff: totals.roundOff,
        total: totals.total,
        notes: clean(v.notes),
        createdById: user.id,
      },
      select: { id: true, number: true },
    });
    await tx.salesInvoiceLine.createMany({
      data: totals.lines.map((l, i) => ({
        organizationId: user.orgId,
        invoiceId: invoice.id,
        position: i + 1,
        description: l.description.trim(),
        hsnSac: l.hsnSac ?? null,
        quantity: l.quantity,
        unit: l.unit.trim(),
        rate: l.rate,
        discountPercent: l.discountPercent,
        gstPercent: l.gstPercent,
        taxable: l.taxable,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
      })),
    });
    return invoice;
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_INVOICE_ISSUED", module: "SALES", entityId: created.id, details: { number: created.number, total: totals.total } });
  return { ok: true, id: created.id, number: created.number };
}

export type InvoiceRow = { id: string; number: string; customerName: string; invoiceDate: string; dueDate: string | null; total: number; received: number; balance: number; status: SalesStatus; overdue: boolean };

export async function listInvoices(user: SalesUser, filter: { status?: string; q?: string } = {}): Promise<FlowResult<{ invoices: InvoiceRow[]; totals: { billed: number; received: number; outstanding: number; overdue: number } }>> {
  const denied = await gate(user, "sales:view");
  if (denied) return { ok: false, error: denied };
  const today = await companyToday(user.orgId);
  const q = filter.q?.trim().slice(0, 60);
  const status = (["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const).find((s) => s === filter.status);
  const rows = await dbFor(user.orgId).salesInvoice.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { receipts: { select: { amount: true } } },
  });
  let billed = 0;
  let received = 0;
  let overdue = 0;
  const invoices = rows.map((r) => {
    const rec = r.receipts.reduce((s, x) => s + toPaise(num(x.amount)), 0) / 100;
    const total = num(r.total);
    const balance = r.status === "CANCELLED" ? 0 : Math.max(0, (toPaise(total) - toPaise(rec)) / 100);
    const late = isOverdue(dateOnly(r.dueDate), today, r.status);
    if (r.status !== "CANCELLED") {
      billed += toPaise(total);
      received += toPaise(rec);
      if (late) overdue += toPaise(balance);
    }
    return { id: r.id, number: r.number, customerName: r.customerName, invoiceDate: dateOnly(r.invoiceDate)!, dueDate: dateOnly(r.dueDate), total, received: rec, balance, status: r.status, overdue: late };
  });
  return { ok: true, invoices, totals: { billed: billed / 100, received: received / 100, outstanding: Math.max(0, billed - received) / 100, overdue: overdue / 100 } };
}

export type InvoiceView = {
  id: string; number: string; status: SalesStatus; invoiceDate: string; dueDate: string | null; overdue: boolean;
  customer: { id: string; name: string; gstin: string | null; address: string | null };
  placeOfSupply: string; supply: "intra" | "inter"; notes: string | null;
  taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; received: number; balance: number;
  lines: { position: number; description: string; hsnSac: string | null; quantity: number; unit: string; rate: number; discountPercent: number; gstPercent: number; taxable: number; taxAmount: number; lineTotal: number }[];
  receipts: { id: string; amount: number; receivedOn: string; mode: string | null; reference: string | null }[];
};

export async function getInvoice(user: SalesUser, id: string): Promise<FlowResult<{ invoice: InvoiceView; profile: Profile | null }>> {
  const denied = await gate(user, "sales:view");
  if (denied) return { ok: false, error: denied };
  const today = await companyToday(user.orgId);
  const r = await dbFor(user.orgId).salesInvoice.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, receipts: { orderBy: [{ receivedOn: "asc" }, { createdAt: "asc" }] } } });
  if (!r) return { ok: false, error: "That invoice was not found." };
  const received = r.receipts.reduce((s, x) => s + toPaise(num(x.amount)), 0) / 100;
  const total = num(r.total);
  const profile = await getProfile(user.orgId);
  return {
    ok: true,
    profile,
    invoice: {
      id: r.id, number: r.number, status: r.status, invoiceDate: dateOnly(r.invoiceDate)!, dueDate: dateOnly(r.dueDate), overdue: isOverdue(dateOnly(r.dueDate), today, r.status),
      customer: { id: r.customerId, name: r.customerName, gstin: r.customerGstin, address: r.customerAddress },
      placeOfSupply: r.placeOfSupply, supply: num(r.igst) > 0 || (profile && profile.stateCode !== r.placeOfSupply) ? "inter" : "intra", notes: r.notes,
      taxable: num(r.taxable), cgst: num(r.cgst), sgst: num(r.sgst), igst: num(r.igst), roundOff: num(r.roundOff), total, received,
      balance: r.status === "CANCELLED" ? 0 : Math.max(0, (toPaise(total) - toPaise(received)) / 100),
      lines: r.lines.map((l) => ({ position: l.position, description: l.description, hsnSac: l.hsnSac, quantity: num(l.quantity), unit: l.unit, rate: num(l.rate), discountPercent: num(l.discountPercent), gstPercent: num(l.gstPercent), taxable: num(l.taxable), taxAmount: num(l.taxAmount), lineTotal: num(l.lineTotal) })),
      receipts: r.receipts.map((x) => ({ id: x.id, amount: num(x.amount), receivedOn: dateOnly(x.receivedOn)!, mode: x.mode, reference: x.reference })),
    },
  };
}

/** Cancels an invoice that has no money received against it. The number stays used (it is never given to another invoice). */
export async function cancelInvoice(user: SalesUser, id: string): Promise<FlowResult> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const db = dbFor(user.orgId);
  const r = await db.$transaction(async (tx) => {
    await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${id} FOR UPDATE`;
    const inv = await tx.salesInvoice.findFirst({ where: { id }, select: { id: true, number: true, status: true, _count: { select: { receipts: true } } } });
    if (!inv) return { ok: false as const, error: "That invoice was not found." };
    if (inv.status === "CANCELLED") return { ok: false as const, error: "This invoice is already cancelled." };
    if (inv._count.receipts > 0) return { ok: false as const, error: "Money has been received on this invoice. Remove the payments first, then cancel it." };
    await tx.salesInvoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return { ok: true as const, number: inv.number };
  });
  if (!r.ok) return r;
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_INVOICE_CANCELLED", module: "SALES", entityId: id, details: { number: r.number } });
  return { ok: true };
}

const receiptSchema = z.object({ amount: z.coerce.number().positive("Enter the amount received."), receivedOn: day, mode: z.string().trim().max(40).optional(), reference: z.string().trim().max(100).optional() });

async function resync(tx: Parameters<Parameters<ReturnType<typeof dbFor>["$transaction"]>[0]>[0], id: string) {
  const inv = await tx.salesInvoice.findFirstOrThrow({ where: { id }, select: { total: true, status: true } });
  const sum = await tx.salesReceipt.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });
  const status = statusFromReceipts(num(inv.total), Number(sum._sum.amount ?? 0), inv.status === "CANCELLED");
  await tx.salesInvoice.update({ where: { id }, data: { status } });
  return status;
}

export async function recordReceipt(user: SalesUser, invoiceId: string, raw: unknown): Promise<FlowResult<{ status: SalesStatus; balance: number }>> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the payment.", field: parsed.error.issues[0]?.path?.[0] as string | undefined };
  const v = parsed.data;
  const db = dbFor(user.orgId);
  const result = await db.$transaction(async (tx) => {
    await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.salesInvoice.findFirst({ where: { id: invoiceId }, select: { total: true, status: true } });
    if (!inv) return { ok: false as const, error: "That invoice was not found." };
    if (inv.status === "CANCELLED") return { ok: false as const, error: "A cancelled invoice cannot receive payments." };
    const sum = await tx.salesReceipt.aggregate({ where: { invoiceId }, _sum: { amount: true } });
    const remaining = toPaise(num(inv.total)) - toPaise(Number(sum._sum.amount ?? 0));
    if (toPaise(v.amount) > remaining) return { ok: false as const, error: `The payment cannot be more than the balance of ${(remaining / 100).toFixed(2)}.`, field: "amount" };
    await tx.salesReceipt.create({ data: { organizationId: user.orgId, invoiceId, amount: v.amount, receivedOn: asDate(v.receivedOn), mode: clean(v.mode), reference: clean(v.reference), createdById: user.id } });
    const status = await resync(tx, invoiceId);
    return { ok: true as const, status, balance: Math.max(0, remaining - toPaise(v.amount)) / 100 };
  });
  if (!result.ok) return result;
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_RECEIPT_ADDED", module: "SALES", entityId: invoiceId, details: { amount: v.amount } });
  return { ok: true, status: result.status, balance: result.balance };
}

export async function deleteReceipt(user: SalesUser, receiptId: string): Promise<FlowResult> {
  const denied = await gate(user, "sales:write");
  if (denied) return { ok: false, error: denied };
  const db = dbFor(user.orgId);
  const found = await db.salesReceipt.findFirst({ where: { id: receiptId }, select: { invoiceId: true, amount: true } });
  if (!found) return { ok: false, error: "That payment was not found." };
  await db.$transaction(async (tx) => {
    await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw`SELECT "id" FROM "SalesInvoice" WHERE "id" = ${found.invoiceId} FOR UPDATE`;
    await tx.salesReceipt.delete({ where: { id: receiptId } });
    await resync(tx, found.invoiceId);
  });
  await logActivity({ userId: user.id, organizationId: user.orgId, action: "SALES_RECEIPT_DELETED", module: "SALES", entityId: found.invoiceId, details: { amount: num(found.amount) } });
  return { ok: true };
}

// ------------------------------------------------------------------ GSTR-1 style downloads

export type ExportKind = "b2b" | "hsn" | "invoices";

/** CSV for the accountant. "b2b": one row per invoice and tax rate (the layout of the GSTR-1 invoice tables); "hsn": totals by HSN/SAC; "invoices": one row per invoice. Cancelled invoices are left out. */
export async function exportCsv(user: SalesUser, kind: ExportKind, from: string, to: string): Promise<FlowResult<{ filename: string; csv: string }>> {
  const denied = await gate(user, "sales:view");
  if (denied) return { ok: false, error: denied };
  if (!day.safeParse(from).success || !day.safeParse(to).success || from > to) return { ok: false, error: "Choose a valid period (from the first date to the last)." };
  const rows = await dbFor(user.orgId).salesInvoice.findMany({
    where: { status: { not: "CANCELLED" }, invoiceDate: { gte: asDate(from), lte: asDate(to) } },
    orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
    include: { lines: { orderBy: { position: "asc" } } },
  });
  const profile = await getProfile(user.orgId);
  const state = (code: string) => `${code}-${GST_STATES[code] ?? code}`;
  const out: (string | number)[][] = [];
  if (kind === "invoices") {
    out.push(["Invoice number", "Invoice date", "Customer", "Customer GSTIN", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Round off", "Invoice value", "Status"]);
    for (const r of rows) out.push([r.number, dateOnly(r.invoiceDate)!, r.customerName, r.customerGstin ?? "", state(r.placeOfSupply), num(r.taxable), num(r.cgst), num(r.sgst), num(r.igst), num(r.roundOff), num(r.total), r.status]);
  } else if (kind === "b2b") {
    out.push(["Type", "GSTIN/UIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Rate %", "Taxable value", "IGST", "CGST", "SGST"]);
    for (const r of rows) {
      const intra = profile ? profile.stateCode === r.placeOfSupply : num(r.igst) === 0;
      const byRate = new Map<number, { taxable: number; tax: number }>();
      for (const l of r.lines) {
        const key = num(l.gstPercent);
        const cur = byRate.get(key) ?? { taxable: 0, tax: 0 };
        cur.taxable += toPaise(num(l.taxable));
        cur.tax += toPaise(num(l.taxAmount));
        byRate.set(key, cur);
      }
      for (const [rate, t] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
        const half = Math.round(t.tax / 2);
        out.push([r.customerGstin ? "B2B" : "B2C", r.customerGstin ?? "", r.customerName, r.number, dateOnly(r.invoiceDate)!, num(r.total), state(r.placeOfSupply), rate, t.taxable / 100, intra ? 0 : t.tax / 100, intra ? half / 100 : 0, intra ? (t.tax - half) / 100 : 0]);
      }
    }
  } else {
    out.push(["HSN/SAC", "Description", "Unit", "Total quantity", "Total value", "Taxable value", "IGST", "CGST", "SGST"]);
    const byHsn = new Map<string, { desc: string; unit: string; qty: number; taxable: number; tax: number; igst: number; cgst: number; sgst: number }>();
    for (const r of rows) {
      const intra = profile ? profile.stateCode === r.placeOfSupply : num(r.igst) === 0;
      for (const l of r.lines) {
        const key = `${l.hsnSac ?? "-"}|${l.unit.toUpperCase()}`;
        const cur = byHsn.get(key) ?? { desc: l.description, unit: l.unit, qty: 0, taxable: 0, tax: 0, igst: 0, cgst: 0, sgst: 0 };
        const tax = toPaise(num(l.taxAmount));
        const half = Math.round(tax / 2);
        cur.qty += num(l.quantity);
        cur.taxable += toPaise(num(l.taxable));
        cur.tax += tax;
        if (intra) {
          cur.cgst += half;
          cur.sgst += tax - half;
        } else cur.igst += tax;
        byHsn.set(key, cur);
      }
    }
    for (const [key, t] of [...byHsn.entries()].sort((a, b) => a[0].localeCompare(b[0]))) out.push([key.split("|")[0] === "-" ? "" : key.split("|")[0], t.desc, t.unit, Number(t.qty.toFixed(3)), (t.taxable + t.tax) / 100, t.taxable / 100, t.igst / 100, t.cgst / 100, t.sgst / 100]);
  }
  // A byte-order mark so Excel opens rupee signs and Indian names correctly.
  const csv = `﻿${out.map((row) => row.map((c) => csvCell(c)).join(",")).join("\r\n")}\r\n`;
  return { ok: true, filename: `sales-${kind}-${from}-to-${to}.csv`, csv };
}
