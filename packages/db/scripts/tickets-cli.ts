// Operator command for support tickets (until the admin console exists). Run from the repo root:
//   npm run ticket -- list [--status OPEN|WAITING|RESOLVED]
//   npm run ticket -- show 123
//   npm run ticket -- status 123 WAITING|RESOLVED|OPEN
// Replies to customers are sent by email (the request email's reply-to is the customer); this only tracks status.
// Uses the owner connection (MIGRATE_DATABASE_URL, else DATABASE_URL).
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

config({ path: "../../.env" });
config();

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL }) });
const ref = (n: number) => `SUP-${String(n).padStart(6, "0")}`;
const STATUSES = ["OPEN", "WAITING", "RESOLVED"] as const;
type Status = (typeof STATUSES)[number];

async function main() {
  const [command, a, b] = process.argv.slice(2);

  if (command === "list") {
    const status = (process.argv.includes("--status") ? process.argv[process.argv.indexOf("--status") + 1] : "").toUpperCase();
    if (status && !STATUSES.includes(status as Status)) throw new Error("--status must be OPEN, WAITING or RESOLVED.");
    const rows = await db.supportTicket.findMany({
      where: status ? { status: status as Status } : {},
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: { organization: { select: { name: true, slug: true } } },
      take: 200,
    });
    if (rows.length === 0) console.log("No tickets.");
    for (const t of rows) {
      console.log(`${ref(t.number)}  ${t.status.padEnd(8)} ${t.priority.padEnd(6)} ${t.createdAt.toISOString().slice(0, 16).replace("T", " ")}  ${t.organization.slug}  ${t.name}: ${t.subject}`);
    }
  } else if (command === "show" && a) {
    const t = await db.supportTicket.findUnique({ where: { number: Number(a) }, include: { organization: { select: { name: true, slug: true } } } });
    if (!t) throw new Error(`No ticket ${a}.`);
    console.log(`${ref(t.number)}  ${t.status}  priority ${t.priority}  plan ${t.planCode ?? "-"}\nCompany: ${t.organization.name} (${t.organization.slug})\nFrom: ${t.name} <${t.email}>\nCreated: ${t.createdAt.toISOString()}\nSubject: ${t.subject}\n\n${t.body}`);
  } else if (command === "status" && a && b) {
    const status = b.toUpperCase() as Status;
    if (!STATUSES.includes(status)) throw new Error("Status must be OPEN, WAITING or RESOLVED.");
    const t = await db.supportTicket.update({
      where: { number: Number(a) },
      data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null },
    });
    console.log(`${ref(t.number)} is now ${t.status}.`);
  } else {
    console.log("Usage: npm run ticket -- list [--status X] | show <number> | status <number> <OPEN|WAITING|RESOLVED>");
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
