import { randomBytes } from "crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: "../../.env" }); // repo-level .env
loadEnv();
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";


/** Strong random password for first-time seeding when none is set in .env. */
function randomPassword() {
  return randomBytes(12).toString("base64url");
}

// Seeding writes company tables, so it must run as the owner role (Row-Level Security
// exempts it). Falls back to DATABASE_URL on databases without a separate app role.
const adapter = new PrismaPg({
  connectionString: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL,
});
const db = new PrismaClient({ adapter });

const DEFAULT_CATEGORIES: Array<{
  name: string;
  unit: string;
  materials: Array<{ name: string; defaultUnit: string; hsnCode?: string }>;
}> = [
  {
    name: "Plumbing",
    unit: "NOS",
    materials: [
      { name: "PVC Pipe 4 inch", defaultUnit: "NOS" },
      { name: "CPVC Elbow 1 inch", defaultUnit: "NOS" },
    ],
  },
  {
    name: "Steel",
    unit: "KG",
    materials: [
      { name: "TMT Rod 8mm", defaultUnit: "KG" },
      { name: "TMT Rod 12mm", defaultUnit: "KG" },
      { name: "TMT Rod 16mm", defaultUnit: "KG" },
    ],
  },
  {
    name: "Cement",
    unit: "BAG",
    materials: [{ name: "OPC 53 Grade Cement", defaultUnit: "BAG" }],
  },
  {
    name: "Tiles",
    unit: "NOS",
    materials: [{ name: "Vitrified Tile 600x600", defaultUnit: "NOS" }],
  },
  {
    name: "Sanitaryware",
    unit: "NOS",
    materials: [{ name: "Jaquar Wall Mixer", defaultUnit: "NOS" }],
  },
  {
    name: "Tile Adhesive",
    unit: "BAG",
    materials: [
      { name: "Sumeru Unique 501 40Kg", defaultUnit: "BAG", hsnCode: "38244090" },
    ],
  },
  {
    name: "Marble/Granite",
    unit: "SQFT",
    materials: [{ name: "Amaze Marble", defaultUnit: "SQFT" }],
  },
  {
    name: "Misc",
    unit: "NOS",
    materials: [],
  },
];

const ORG_ID = "org_default";

async function main() {
  console.log("Seeding default company...");
  await db.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: process.env.SEED_COMPANY_NAME?.trim() || "My Company",
      slug: process.env.SEED_COMPANY_SLUG?.trim() || "my-company",
      status: "ACTIVE",
    },
  });

  console.log("Seeding plan subscription...");
  const plan = await db.plan.findUniqueOrThrow({ where: { code: "PROJECT" } });
  await db.subscription.upsert({
    where: { organizationId: ORG_ID },
    update: {},
    create: { organizationId: ORG_ID, planId: plan.id, quantity: 1, status: "ACTIVE", provider: "manual" },
  });

  console.log("Seeding categories & materials...");
  for (const category of DEFAULT_CATEGORIES) {
    const created = await db.category.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: category.name } },
      update: {},
      create: { organizationId: ORG_ID, name: category.name, unit: category.unit },
    });

    for (const material of category.materials) {
      await db.material.upsert({
        where: { categoryId_name: { categoryId: created.id, name: material.name } },
        update: {},
        create: {
          organizationId: ORG_ID,
          categoryId: created.id,
          name: material.name,
          defaultUnit: material.defaultUnit,
          hsnCode: material.hsnCode,
        },
      });
    }
  }

  console.log("Seeding demo project...");
  const project = await db.project.upsert({
    where: { id: "demo-project" },
    update: {},
    create: { id: "demo-project", organizationId: ORG_ID, name: "Demo project", address: "" },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || randomPassword();
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  console.log(`Seeding admin user (${adminEmail})...`);
  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      emailVerifiedAt: new Date(), // seeded by the operator: no confirmation email needed
      memberships: { create: { organizationId: ORG_ID, role: "ADMIN" } },
    },
  });

  const staffEmail = process.env.SEED_STAFF_EMAIL ?? "staff@example.com";
  const staffPassword = process.env.SEED_STAFF_PASSWORD?.trim() || randomPassword();
  const staffPasswordHash = await bcrypt.hash(staffPassword, 12);

  console.log(`Seeding staff user (${staffEmail})...`);
  const staff = await db.user.upsert({
    where: { email: staffEmail },
    update: {},
    create: {
      email: staffEmail,
      name: "Staff",
      passwordHash: staffPasswordHash,
      role: "STAFF",
      emailVerifiedAt: new Date(), // seeded by the operator: no confirmation email needed
      memberships: { create: { organizationId: ORG_ID, role: "STAFF" } },
    },
  });

  await db.projectAssignment.upsert({
    where: { userId_projectId: { userId: staff.id, projectId: project.id } },
    update: {},
    create: { organizationId: ORG_ID, userId: staff.id, projectId: project.id },
  });

  console.log("Seed complete.");
  console.log(`  Admin login: ${admin.email} / ${adminPassword}`);
  console.log(`  Staff login: ${staff.email} / ${staffPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
