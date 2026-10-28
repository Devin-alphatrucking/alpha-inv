import { homeFor } from "@/lib/roles";
import { redirect } from "next/navigation";
import { pageOrg } from "@/lib/org/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UsersManager } from "./users-manager";
import { InvitePanel } from "./invite-panel";
import { getEntitlements } from "@/lib/plans/entitlements";
import { checkAddUsers } from "@/lib/plans/rules";
import { listPendingInvites } from "@/lib/flows/invite";
import { isEmailConfigured } from "@/lib/email/transport";
import { rawDb } from "@/lib/db";

export default async function UsersPage() {
  const { session, db, orgId } = await pageOrg();
  if (session.user.role !== "ADMIN") redirect(homeFor(session.user.role));

  const pendingInvites = await listPendingInvites(orgId);
  const plan = await getEntitlements(orgId);
  const seatCheck = checkAddUsers(plan.state, plan.limits, plan.usage, 1);

  const [users, projects] = await Promise.all([
    // only people who belong to this company, with this company's role and projects
    db.user.findMany({
      where: { memberships: { some: { organizationId: orgId } } },
      orderBy: { createdAt: "asc" },
      include: {
        memberships: { where: { organizationId: orgId }, select: { role: true } },
        projectAssignments: {
          where: { organizationId: orgId },
          include: { project: true },
        },
      },
    }),
    db.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // People who also belong to another company: their password and profile are theirs, so the Password dialog offers a reset link only.
  const shared = new Set((await rawDb.membership.findMany({ where: { userId: { in: users.map((u) => u.id) }, organizationId: { not: orgId } }, select: { userId: true } })).map((m) => m.userId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          ADMIN users see everything; STAFF users are scoped to assigned
          projects.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            Send an email invitation. They set their own password, so you never handle it.{" "}
            People: <span className="font-medium text-foreground">{plan.usage.users + plan.usage.pendingInvites}</span> of {plan.limits.users} used (including open invitations).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitePanel
            projects={projects}
            pending={pendingInvites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
            emailReady={isEmailConfigured()}
            limitMessage={seatCheck.ok ? null : seatCheck.message}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users ({users.length})</CardTitle>
          <CardDescription>
            Create, edit, or remove accounts and assign staff to projects.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersManager
            currentUserId={session.user.id}
            projects={projects}
            users={users.map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              sharedWithOtherCompanies: shared.has(user.id),
              role: user.memberships[0]?.role ?? user.role,
              projectIds: user.projectAssignments.map((a) => a.projectId),
              projectNames: user.projectAssignments.map(
                (a) => a.project.name
              ),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
