import Link from "next/link";
import { rawDb } from "@/lib/db";
import { pageOrg } from "@/lib/org/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FolderKanban } from "lucide-react";
import { projectAccessWhere } from "@/lib/projects/access";
import { getUsageSummary } from "@/lib/usage/pages";
import { ProjectsManager, ProjectActions, type AssignableUser } from "./projects-manager";
import { BudgetMeter } from "@/components/budget-meter";
import { getFormat } from "@/lib/brand/brand";
import { getEntitlements } from "@/lib/plans/entitlements";
import { checkAddProject } from "@/lib/plans/rules";

function statusVariant(status: string) {
  if (status === "COMPLETED") return "default" as const;
  if (status === "ARCHIVED") return "secondary" as const;
  return "outline" as const;
}

export default async function ProjectsPage() {
  const { session, db, orgId, user } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 0) => fmt.money(value, maxFraction);

  const isAdmin = session.user.role === "ADMIN";
  const plan = await getEntitlements(orgId);
  const addCheck = checkAddProject(plan.state, plan.limits, plan.usage);
  const accessWhere = projectAccessWhere(user);

  const [projects, users] = await Promise.all([
    db.project.findMany({
      where: accessWhere,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
        invoices: {
          select: {
            total: true,
            status: true,
            payments: { select: { amount: true } },
          },
        },
      },
    }),
    isAdmin
      ? rawDb.user.findMany({
          // only people who belong to this company
          where: { memberships: { some: { organizationId: orgId } } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, role: true },
        })
      : Promise.resolve([]),
  ]);

  const usage = await getUsageSummary(orgId, projects.map((p) => p.id));

  const rows = projects.map((project) => {
    let total = 0;
    let paid = 0;
    let pending = 0;
    for (const invoice of project.invoices) {
      // Invoices still being read or reviewed are not counted yet (same rule as the dashboard and the project page).
      if (invoice.status === "PROCESSING" || invoice.status === "NEEDS_REVIEW") continue;
      const t = Number(invoice.total);
      const p = invoice.payments.reduce((s, pay) => s + Number(pay.amount), 0);
      total += t;
      paid += p;
      pending += Math.max(0, t - p);
    }
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      address: project.address,
      status: project.status,
      invoiceCount: project.invoices.length,
      memberNames: project.assignments.map((a) => a.user.name),
      userIds: project.assignments.map((a) => a.user.id),
      azureEndpoint: isAdmin ? project.azureEndpoint : null,
      azureKeyHint: isAdmin ? project.azureKeyHint : null,
      monthlyPageLimit: project.monthlyPageLimit,
      pagesUsed: usage.byProject[project.id] ?? 0,
      total,
      paid,
      pending: Math.max(0, pending),
      budget: project.budget ? Number(project.budget) : null,
      spent: total,
    };
  });

  const assignableUsers: AssignableUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isAdmin ? "Projects" : "My projects"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Construction sites and workspaces. Assign staff and track spend."
              : "Projects you have access to."}
          </p>
          {isAdmin && (
            <p className="mt-1 text-xs text-muted-foreground">
              Active projects: <span className="font-medium text-foreground">{plan.usage.projects}</span> of {plan.limits.projects}.{" "}
              {!addCheck.ok && <span className="text-amber-700">{addCheck.message}</span>}
            </p>
          )}
        </div>
        {isAdmin && (
          <ProjectsManager users={assignableUsers} limitMessage={addCheck.ok ? null : addCheck.message} />
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-muted p-4">
              <FolderKanban className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No projects yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {isAdmin
                  ? "Create your first project to organize invoices and assign staff."
                  : "You have not been assigned to any projects yet."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="transition-shadow duration-200 hover:shadow-sm">
          <CardHeader>
            <CardTitle>All projects ({rows.length})</CardTitle>
            <CardDescription>
              Invoiced, paid, and pending totals per project
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {rows.map((project) => (
                <div key={project.id} className="rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
                  {/* The link covers the summary only: Edit and Delete sit outside it, so tapping them never opens the project page. */}
                  <Link href={`/projects/${project.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{project.name}</p>
                      {project.address && (
                        <p className="truncate text-xs text-muted-foreground">
                          {project.address}
                        </p>
                      )}
                    </div>
                    <Badge variant={statusVariant(project.status)}>
                      {project.status}
                    </Badge>
                  </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      AI pages this month: {project.pagesUsed} / {project.monthlyPageLimit}
                    </p>
                    {project.budget ? (
                      <div className="mt-3">
                        <BudgetMeter spent={project.spent} budget={project.budget} money={(n) => formatCurrency(n)} />
                      </div>
                    ) : null}
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">Invoiced</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {formatCurrency(project.total)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">Paid</p>
                        <p className="text-sm font-semibold tabular-nums text-emerald-600">
                          {formatCurrency(project.paid)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">Pending</p>
                        <p className="text-sm font-semibold tabular-nums text-amber-600">
                          {formatCurrency(project.pending)}
                        </p>
                      </div>
                    </div>
                  </Link>
                  {isAdmin && (
                    <div className="mt-3 border-t pt-3">
                      <ProjectActions project={project} users={assignableUsers} />
                    </div>
                  )}
                </div>
              ))}
              </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden xl:table-cell">Team</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">AI pages (month)</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/projects/${project.id}`}
                          className="hover:underline underline-offset-4"
                        >
                          {project.name}
                        </Link>
                        {project.budget ? (
                          <div className="mt-1.5 max-w-60 font-normal">
                            <BudgetMeter spent={project.spent} budget={project.budget} money={(n) => formatCurrency(n)} />
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(project.status)}>
                          {project.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">
                        {project.memberNames.length > 0
                          ? project.memberNames.join(", ")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {project.invoiceCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {project.pagesUsed} / {project.monthlyPageLimit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(project.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">
                        {formatCurrency(project.paid)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600">
                        {formatCurrency(project.pending)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <ProjectActions project={project} users={assignableUsers} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
