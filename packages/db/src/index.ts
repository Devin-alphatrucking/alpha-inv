// Single entry point for the database: the shared client plus every generated
// Prisma type (Prisma namespace, enums, model types). Apps import from "@alpha/db".
export { db } from "./client";
export * from "./generated/prisma/client";
