import type { Prisma } from "@alpha/db";
import { COUNTRY_DEFAULTS, STARTER_CATEGORIES } from "@/lib/org/starter-data";

type Tx = Prisma.TransactionClient;

export type CompanyPlanMode =
  /** A free trial of one project plan that ends after `days`. */
  | { kind: "trial"; days: number }
  /** Managed by hand: `quantity` project plans, active with no end date and no payment provider. */
  | { kind: "managed"; quantity: number };

async function createOrganization(tx: Tx, input: { companyName: string; slug: string; country: string; mode: CompanyPlanMode }) {
  const defaults = COUNTRY_DEFAULTS[input.country];
  if (!defaults) throw new Error(`Unknown country: ${input.country}`);
  return tx.organization.create({
    data: {
      name: input.companyName,
      slug: input.slug,
      status: input.mode.kind === "managed" ? "ACTIVE" : "TRIAL",
      country: input.country,
      currency: defaults.currency,
      timezone: defaults.timezone,
    },
  });
}

/** The plan record, starter categories and a first project (assigned to the administrator) for a company that was just created. */
async function seedCompany(tx: Tx, orgId: string, adminUserId: string, mode: CompanyPlanMode) {
  const plan = await tx.plan.findUnique({ where: { code: "PROJECT" } });
  if (!plan || !plan.active) throw new Error("The default plan (PROJECT) is missing. Run the database migrations.");
  await tx.subscription.create({
    data:
      mode.kind === "managed"
        ? { organizationId: orgId, planId: plan.id, quantity: mode.quantity, status: "ACTIVE", provider: "manual" }
        : { organizationId: orgId, planId: plan.id, quantity: 1, status: "TRIALING", trialEndsAt: new Date(Date.now() + mode.days * 86_400_000), provider: "manual" },
  });
  // The company tables are protected by Row-Level Security: say which company we are writing for.
  await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
  await tx.category.createMany({ data: STARTER_CATEGORIES.map((c) => ({ organizationId: orgId, name: c.name, unit: c.unit })) });
  const project = await tx.project.create({ data: { organizationId: orgId, name: "My first project" } });
  await tx.projectAssignment.create({ data: { organizationId: orgId, userId: adminUserId, projectId: project.id } });
}

/**
 * Creates a company with its first administrator, a plan record, starter categories and a first project, inside the
 * caller's transaction. Used by self-service sign-up and by the master console, so both start a company the same way.
 * `passwordHash` is whatever the caller decided (a real hash from the sign-up form, or an unusable one until the person
 * sets their password from an emailed link).
 */
export async function provisionCompany(
  tx: Tx,
  input: { companyName: string; slug: string; country: string; adminName: string; adminEmail: string; adminPhone?: string | null; passwordHash: string; termsAccepted: boolean; mode: CompanyPlanMode },
) {
  const org = await createOrganization(tx, input);
  const user = await tx.user.create({
    data: {
      name: input.adminName,
      email: input.adminEmail,
      phone: input.adminPhone ?? null,
      passwordHash: input.passwordHash,
      role: "ADMIN",
      // Sign-up ticks the box; a company our team sets up has not accepted anything yet.
      termsAcceptedAt: input.termsAccepted ? new Date() : null,
      memberships: { create: { organizationId: org.id, role: "ADMIN" } },
    },
  });
  await seedCompany(tx, org.id, user.id, input.mode);
  return { org, user };
}

/** The same, for someone who already has an account (for example an employee of another company): they become this company's administrator. */
export async function provisionCompanyForUser(tx: Tx, input: { companyName: string; slug: string; country: string; userId: string; mode: CompanyPlanMode }) {
  const org = await createOrganization(tx, input);
  await tx.membership.create({ data: { userId: input.userId, organizationId: org.id, role: "ADMIN" } });
  await seedCompany(tx, org.id, input.userId, input.mode);
  return { org };
}
