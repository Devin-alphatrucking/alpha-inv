// Put a logo on a company from the command line (handy for moving an existing company's
// logo into the database, or for support). Run from the repo root:
//   npm run brand:logo -- <company slug> <path to png/jpeg/webp>
// Uses the owner connection (MIGRATE_DATABASE_URL, else DATABASE_URL). Max 300 KB; SVG is refused.
import { config } from "dotenv";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: "../../.env" });
config();

const MAX = 300 * 1024;

function detect(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function main() {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) {
    console.error("Usage: npm run brand:logo -- <company slug> <image file>");
    process.exit(2);
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  const type = detect(bytes);
  if (!type) throw new Error("The file must be a PNG, JPEG or WebP image.");
  if (bytes.length > MAX) throw new Error(`The logo must be ${MAX / 1024} KB or smaller (this one is ${Math.round(bytes.length / 1024)} KB).`);

  const adapter = new PrismaPg({ connectionString: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter });
  try {
    const org = await db.organization.findUnique({ where: { slug } });
    if (!org) throw new Error(`No company with slug "${slug}".`);
    await db.$transaction([
      db.organizationLogo.upsert({
        where: { organizationId: org.id },
        create: { organizationId: org.id, contentType: type, data: bytes },
        update: { contentType: type, data: bytes },
      }),
      db.organization.update({ where: { id: org.id }, data: { logoUrl: `/api/branding/logo/${org.slug}?v=${Date.now()}` } }),
    ]);
    console.log(`Logo set for "${org.name}" (${type}, ${Math.round(bytes.length / 1024)} KB).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
