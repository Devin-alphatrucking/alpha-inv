// Who may use the master console (our own team). This is the ONLY way to grant or remove the access:
// there is no screen and no sign-up path for it. Run from the repo root:
//   npm run master -- list
//   npm run master -- add <email>       the person must already have a verified account (and be an ADMIN of a company, to see the app around it)
//   npm run master -- remove <email>
// Uses the owner connection (MIGRATE_DATABASE_URL, else DATABASE_URL). Every change is written to the activity log.
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: "../../.env" });
config();

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL }) });

async function main() {
  const [command, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();

  if (command === "list") {
    const admins = await db.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true, name: true, emailVerifiedAt: true, deletedAt: true } });
    if (!admins.length) console.log("No platform operators yet. Add one with: npm run master -- add <email>");
    for (const a of admins) console.log(`${a.email}  ${a.name}${a.emailVerifiedAt ? "" : "  (email not verified: cannot use the console)"}${a.deletedAt ? "  (deleted account)" : ""}`);
  } else if ((command === "add" || command === "remove") && email) {
    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new Error(`No active account for ${email}. They must sign up first.`);
    if (command === "add" && !user.emailVerifiedAt) throw new Error(`${email} has not verified their email yet.`);
    await db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: command === "add" } });
    // Signing out everywhere makes the change take effect at once.
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    await db.activityLog.create({ data: { userId: user.id, action: command === "add" ? "MASTER_OPERATOR_ADDED" : "MASTER_OPERATOR_REMOVED", module: "MASTER", entityId: user.id, details: { by: "operator command", email } } });
    console.log(command === "add" ? `${email} can now open /master. They were signed out everywhere and must sign in again.` : `${email} can no longer open /master.`);
  } else {
    console.log("Usage: npm run master -- list | add <email> | remove <email>");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
