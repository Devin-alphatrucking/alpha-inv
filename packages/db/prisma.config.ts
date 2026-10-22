// Prisma CLI config for the shared database package.
// Commands run from packages/db (via the root `npm run db:*` scripts), and the
// single repo-level .env (two folders up) holds DATABASE_URL.
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: "../../.env" });
config(); // optional packages/db/.env override

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations run as the database OWNER (MIGRATE_DATABASE_URL); the app itself
    // connects as a separate role through DATABASE_URL so Row-Level Security applies.
    url: process.env["MIGRATE_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
