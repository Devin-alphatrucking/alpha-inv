// Operator command for plans and subscriptions (until the admin console exists).
// Run from the repo root:
//   npm run plan -- list
//   npm run plan -- show <company slug>
//   npm run plan -- set <company slug> --quantity 2 --status ACTIVE --reason "Bought a second project"
//       other flags: --trial-days N  --grace-days N  --period-end YYYY-MM-DD  --extra-projects N  --extra-users N  --ai-pages N
//   npm run plan -- edit-plan PROJECT --price 99900 --currency INR --users 5 --pages 500 --name "Project plan"
// Uses the owner connection (MIGRATE_DATABASE_URL, else DATABASE_URL). Every change is written to the activity log.
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { computeLimits, parseOverrides, planState, trialDaysLeft } from "../../../apps/web/src/lib/plans/rules";

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
const int = (v: string | undefined, name: string, min = 0) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be a whole number of ${min} or more.`);
  return n;
};
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function usage(orgId: string) {
  const [p, u, i] = await Promise.all([
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Project" WHERE "organizationId" = ${orgId} AND "status" = 'ACTIVE'`,
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Membership" m JOIN "User" u ON u."id" = m."userId" WHERE m."organizationId" = ${orgId} AND u."deletedAt" IS NULL`,
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "AuthToken" WHERE "type" = 'INVITE' AND "organizationId" = ${orgId} AND "usedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > (now() AT TIME ZONE 'UTC')`,
  ]);
  return { projects: p[0].n, users: u[0].n, pendingInvites: i[0].n };
}

async function describe(slug: string) {
  const org = await db.organization.findUnique({ where: { slug }, include: { subscription: { include: { plan: true } } } });
  if (!org) throw new Error(`No company with slug "${slug}".`);
  const u = await usage(org.id);
  const sub = org.subscription;
  console.log(`\n${org.name} (${org.slug}) - company status ${org.status}`);
  if (!sub) {
    console.log("  No subscription. Create one with: npm run plan -- set " + slug + " --quantity 1 --status ACTIVE");
    return;
  }
  const state = planState(sub);
  const limits = computeLimits(sub.plan, sub);
  console.log(`  Plan ${sub.plan.code} x ${sub.quantity}, subscription ${sub.status}, state "${state}"`);
  if (sub.trialEndsAt) console.log(`  Trial ends ${sub.trialEndsAt.toISOString().slice(0, 10)} (${trialDaysLeft(sub)} days left)`);
  if (sub.currentPeriodEnd) console.log(`  Period ends ${sub.currentPeriodEnd.toISOString().slice(0, 10)}`);
  if (sub.graceEndsAt) console.log(`  Grace ends ${sub.graceEndsAt.toISOString().slice(0, 10)}`);
  console.log(`  Projects ${u.projects} of ${limits.projects} | People ${u.users + u.pendingInvites} of ${limits.users} (${u.pendingInvites} invited) | AI pages per project ${limits.aiPagesPerProject}, company cap ${limits.companyPageCap}`);
  const o = parseOverrides(sub.overrides);
  if (o.extraProjects || o.extraUsers || o.aiPagesPerProject !== null) console.log(`  Overrides: ${JSON.stringify(o)}`);
}

async function main() {
  const [command, target, ...rest] = process.argv.slice(2);
  const f = flags(rest);

  if (command === "list") {
    const orgs = await db.organization.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true } });
    for (const o of orgs) await describe(o.slug);
  } else if (command === "show" && target) {
    await describe(target);
  } else if (command === "set" && target) {
    const org = await db.organization.findUnique({ where: { slug: target }, include: { subscription: true } });
    if (!org) throw new Error(`No company with slug "${target}".`);
    const plan = await db.plan.findUniqueOrThrow({ where: { code: f.plan || "PROJECT" } });
    const status = f.status?.toUpperCase();
    if (status && !["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"].includes(status)) throw new Error("--status must be TRIALING, ACTIVE, PAST_DUE or CANCELED.");
    const quantity = int(f.quantity, "quantity", 0);
    if (org.subscription?.billing === "RAZORPAY" && (f.quantity !== undefined || status)) {
      throw new Error("This company pays through Razorpay, so its quantity and status follow its purchases. To give free project plans use: npm run billing -- grant " + target + " <N> --reason \"...\"");
    }
    const current = parseOverrides(org.subscription?.overrides);
    const overrides = {
      extraProjects: int(f["extra-projects"], "extra-projects") ?? current.extraProjects,
      extraUsers: int(f["extra-users"], "extra-users") ?? current.extraUsers,
      ...((int(f["ai-pages"], "ai-pages") ?? current.aiPagesPerProject) !== null && (int(f["ai-pages"], "ai-pages") ?? current.aiPagesPerProject) !== undefined
        ? { aiPagesPerProject: int(f["ai-pages"], "ai-pages") ?? current.aiPagesPerProject }
        : {}),
    };
    const data = {
      planId: plan.id,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(status ? { status: status as "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" } : {}),
      ...(f["trial-days"] ? { trialEndsAt: days(int(f["trial-days"], "trial-days", 1)!) } : {}),
      ...(f["grace-days"] ? { graceEndsAt: days(int(f["grace-days"], "grace-days", 1)!) } : {}),
      ...(f["period-end"] ? { currentPeriodEnd: new Date(f["period-end"]) } : {}),
      overrides,
      provider: org.subscription?.provider ?? "manual",
    };
    await db.subscription.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, quantity: quantity ?? 1, status: (status as "ACTIVE") ?? "ACTIVE", ...data },
      update: data,
    });
    await db.activityLog.create({
      data: {
        organizationId: org.id,
        action: "PLAN_CHANGED",
        module: "COMPANY",
        entityId: org.id,
        details: { by: "operator", reason: f.reason ?? null, flags: f },
      },
    });
    console.log("Saved.");
    await describe(target);
  } else if (command === "edit-plan" && target) {
    const data = {
      ...(f.price !== undefined ? { priceMinor: int(f.price, "price") } : {}),
      ...(f.currency ? { currency: f.currency.toUpperCase() } : {}),
      ...(f.users !== undefined ? { userLimit: int(f.users, "users") } : {}),
      ...(f.pages !== undefined ? { aiPagesPerProject: int(f.pages, "pages") } : {}),
      ...(f.projects !== undefined ? { includedProjects: int(f.projects, "projects", 1) } : {}),
      ...(f.name ? { name: f.name } : {}),
    };
    if (Object.keys(data).length === 0) throw new Error("Nothing to change. Use --price, --currency, --users, --pages, --projects or --name.");
    const plan = await db.plan.update({ where: { code: target }, data });
    console.log(`Plan ${plan.code}: ${plan.name}, ${plan.includedProjects} project(s), ${plan.userLimit} users, ${plan.aiPagesPerProject} AI pages per project, price ${plan.priceMinor === null ? "not set" : `${plan.priceMinor} ${plan.currency} (minor units)`} per ${plan.interval.toLowerCase()}.`);
    console.log("Changing a plan changes the limits of every company on it.");
  } else {
    console.log("Usage: npm run plan -- list | show <slug> | set <slug> [flags] | edit-plan <code> [flags]   (see the top of packages/db/scripts/plans-cli.ts)");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
