import { json, requireMobile, route } from "@/lib/mobile/http";
import { dbFor } from "@/lib/org/scoped-db";
import { projectAccessWhere } from "@/lib/projects/access";

export const runtime = "nodejs";

/** The projects this person may use (everything for an administrator, assigned ones for staff). */
export const GET = route("/api/v1/projects", async (req) => {
  const me = await requireMobile(req);
  const projects = await dbFor(me.orgId).project.findMany({
    where: { ...projectAccessWhere(me), status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, monthlyPageLimit: true },
  });
  return json({ projects });
});
