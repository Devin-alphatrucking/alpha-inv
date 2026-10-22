// Operator command for billing (until the admin console exists). Run from the repo root:
//   npm run billing -- status <company slug>      purchases, payments and the derived subscription
//   npm run billing -- grant <company slug> <N> --reason "..."   set the free project plans (N, 0 or more) given to a company
//   npm run billing -- events [--errors] [--limit 20]            the webhook inbox (most recent first)
// Uses the owner connection (MIGRATE_DATABASE_URL, else DATABASE_URL). Every change is written to the activity log.
// Prices and the Razorpay plan: `npm run plan -- edit-plan PROJECT --price 99900 --currency INR` (the Razorpay plan is created at the first purchase).
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { derive, graceDays, formatMoney } from "../../../apps/web/src/lib/billing/rules";

config({ path: "../../.env" });
config();

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL }) });

function flags(args: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) out[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
  }
  return out;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function org(slug: string) {
  const o = await db.organization.findUnique({ where: { slug }, include: { subscription: true } });
  if (!o) throw new Error(`No company with slug "${slug}".`);
  return o;
}

async function status(slug: string) {
  const o = await org(slug);
  const s = o.subscription;
  console.log(`\n${o.name} (${o.slug})`);
  if (!s) return console.log("  No subscription.");
  console.log(`  Billing mode ${s.billing}; quantity ${s.quantity} (free grants ${s.extraQuantity}); status ${s.status}; period end ${day(s.currentPeriodEnd)}; grace ends ${day(s.graceEndsAt)}; cancel at period end ${s.cancelAtPeriodEnd}`);
  const purchases = await db.billingPurchase.findMany({ where: { organizationId: o.id }, orderBy: { createdAt: "asc" } });
  for (const p of purchases) {
    console.log(`  purchase ${p.id}  ${p.providerSubscriptionId}  ${p.status}  ${formatMoney(p.amountMinor, p.currency)}  paid ${p.paidCount}x  until ${day(p.currentEnd)}${p.cancelAtCycleEnd ? "  (ends at period end)" : ""}${p.pastDueSince ? `  past due since ${day(p.pastDueSince)}` : ""}`);
  }
  if (!purchases.length) console.log("  No purchases.");
  const payments = await db.billingPayment.findMany({ where: { organizationId: o.id }, orderBy: { paidAt: "desc" }, take: 5 });
  for (const p of payments) console.log(`  payment ${p.providerPaymentId}  ${formatMoney(p.amountMinor, p.currency)}  ${day(p.paidAt)}  ${p.method ?? ""}`);
  if (s.billing === "RAZORPAY") {
    const d = derive(purchases, { extraQuantity: s.extraQuantity, trialEndsAt: s.trialEndsAt, graceDays: graceDays(), now: new Date() });
    const same = d.quantity === s.quantity && d.status === s.status;
    console.log(`  Derived from purchases now: quantity ${d.quantity}, status ${d.status}${same ? " (matches)" : "  <-- DIFFERS from the stored subscription"}`);
  }
}

async function main() {
  const [command, target, third, ...rest] = process.argv.slice(2);
  if (command === "status" && target) {
    await status(target);
  } else if (command === "grant" && target && third !== undefined) {
    const f = flags(rest);
    const n = Number(third);
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("The number of free project plans must be a whole number from 0 to 1000.");
    const o = await org(target);
    if (!o.subscription) throw new Error("This company has no subscription yet. Create one with: npm run plan -- set <slug> --quantity 1 --status ACTIVE");
    if (o.subscription.billing !== "RAZORPAY") {
      throw new Error("This company is managed by hand (no purchases yet), so set its plans directly: npm run plan -- set <slug> --quantity N. Grants only apply once billing is on.");
    }
    const purchases = await db.billingPurchase.findMany({ where: { organizationId: o.id }, select: { status: true, currentEnd: true, cancelAtCycleEnd: true, pastDueSince: true, paidCount: true } });
    const d = derive(purchases, { extraQuantity: n, trialEndsAt: o.subscription.trialEndsAt, graceDays: graceDays(), now: new Date() });
    await db.subscription.update({
      where: { organizationId: o.id },
      data: { extraQuantity: n, quantity: d.quantity, status: d.status, currentPeriodEnd: d.currentPeriodEnd, graceEndsAt: d.graceEndsAt, cancelAtPeriodEnd: d.cancelAtPeriodEnd },
    });
    await db.activityLog.create({
      data: { organizationId: o.id, action: "BILLING_CHANGED", module: "BILLING", entityId: o.id, details: { by: "operator", grant: n, reason: f.reason ?? null } },
    });
    console.log("Saved.");
    await status(target);
  } else if (command === "events") {
    const f = flags([target, third, ...rest].filter((x): x is string => typeof x === "string"));
    const rows = await db.billingEvent.findMany({
      where: f.errors ? { outcome: "error" } : {},
      orderBy: { receivedAt: "desc" },
      take: Math.min(200, Number(f.limit) || 20),
      select: { eventId: true, type: true, outcome: true, error: true, receivedAt: true, organizationId: true },
    });
    for (const r of rows) console.log(`${r.receivedAt.toISOString()}  ${r.type.padEnd(28)} ${(r.outcome ?? "pending").padEnd(10)} ${r.organizationId ?? "-"}  ${r.eventId}${r.error ? "  " + r.error : ""}`);
    if (!rows.length) console.log("No events.");
  } else {
    console.log("Usage: npm run billing -- status <slug> | grant <slug> <N> [--reason ...] | events [--errors] [--limit N]");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
