import type { Prisma } from "@alpha/db";
import { COUNTRY_DEFAULTS, STARTER_CATEGORIES } from "@/lib/org/starter-data";

type Tx = Prisma.TransactionClient;

export type CompanyPlanMode =
  /** A free trial of one project plan that ends after `days`. */
  | { kind: "trial"; days: number }
  /** Managed by hand: `quantity` project plans, active with no end date and no payment provider. */
  | { kind: "managed"; quantity: number };

/**
 * Creates a company with its first administrator, a plan record, starter categories and a first project, inside the
 * caller's transaction. Used by self-service sign-up and by the master console, so both start a company the same way.
 * `passwordHash` is whatever the caller decided (a real hash from the sign-up form, or an unusable one until the person
 * sets their password from an emailed link).
 */
export async function provisionCompany(
  tx: Tx,
  input: { companyName: string; slug: string; country: string; adminName: string; adminEmail: string; passwordHash: string; termsAccepted: boolean; mode: CompanyPlanMode },
) {
  const defaults = COUNTRY_DEFAULTS[input.country];
  if (!defaults) throw new Error(`Unknown country: ${input.country}`);

  const org = await tx.organization.create({
    data: {
      name: input.companyName,
      slug: input.slug,
      status: input.mode.kind === "managed" ? "ACTIVE" : "TRIAL",
      country: input.country,
      currency: defaults.currency,
      timezone: defaults.timezone,
    },
  });
  const user = await tx.user.create({
    data: {
      name: input.adminName,
      email: input.adminEmail,
      passwordHash: input.passwordHash,
      role: "ADMIN",
      // Sign-up ticks the box; a company our team sets up has not accepted anything yet.
      termsAcceptedAt: input.termsAccepted ? new Date() : null,
      memberships: { create: { organizationId: org.id, role: "ADMIN" } },
    },
  });
  const plan = await tx.plan.findUnique({ where: { code: "PROJECT" } });
  if (!plan || !plan.active) throw new Error("The default plan (PROJECT) is missing. Run the database migrations.");
  await tx.subscription.create({
    data:
      input.mode.kind === "managed"
        ? { organizationId: org.id, planId: plan.id, quantity: input.mode.quantity, status: "ACTIVE", provider: "manual" }
        : { organizationId: org.id, planId: plan.id, quantity: 1, status: "TRIALING", trialEndsAt: new Date(Date.now() + input.mode.days * 86_400_000), provider: "manual" },
  });
  // The company tables are protected by Row-Level Security: say which company we are writing for.
  await tx.$executeRaw`SELECT set_config('app.org_id', ${org.id}, true)`;
  await tx.category.createMany({ data: STARTER_CATEGORIES.map((c) => ({ organizationId: org.id, name: c.name, unit: c.unit })) });
  const project = await tx.project.create({ data: { organizationId: org.id, name: "My first project" } });
  await tx.projectAssignment.create({ data: { organizationId: org.id, userId: user.id, projectId: project.id } });
  return { org, user };
}
