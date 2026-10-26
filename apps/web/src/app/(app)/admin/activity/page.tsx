import { homeFor } from "@/lib/roles";
import { redirect } from "next/navigation";
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
import type { Prisma } from "@alpha/db";
import { LogsFilters } from "./logs-filters";
import { getFormat } from "@/lib/brand/brand";

const PAGE_SIZE = 50;

const MODULE_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  AUTH: "outline",
  USER: "secondary",
  PROJECT: "outline",
  INVOICE: "default",
  PAYMENT: "secondary",
  VENDOR: "outline",
  CATEGORY: "outline",
};

type SearchParams = Promise<{ page?: string; q?: string; module?: string }>;

export default async function ActivityLogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session, db } = await pageOrg();
  const fmt = await getFormat();
  if (session.user.role !== "ADMIN") redirect(homeFor(session.user.role));

  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page ?? "1", 10) || 1)); // a bad ?page= never reaches the database
  const moduleFilter = params.module || "";
  const q = params.q?.trim() || "";

  const and: Prisma.ActivityLogWhereInput[] = [];
  if (moduleFilter) and.push({ module: moduleFilter });
  if (q) {
    and.push({
      OR: [
        { action: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.ActivityLogWhereInput =
    and.length > 0 ? { AND: and } : {};

  const [total, logs, modules] = await Promise.all([
    db.activityLog.count({ where }),
    db.activityLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.activityLog.groupBy({ by: ["module"], _count: true }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail of important actions across the system.
        </p>
      </div>

      <LogsFilters
        filterOptions={modules.map((m) => ({ value: m.module, label: m.module, count: m._count }))}
        filterLabel="Module"
        filterParam="module"
        total={total}
        page={page}
        totalPages={totalPages}
        currentFilter={moduleFilter}
        currentQuery={q}
      />

      <Card>
        <CardHeader>
          <CardTitle>Events ({total})</CardTitle>
          <CardDescription>
            Page {page} of {totalPages}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No activity matches your filters.
            </p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold">{log.action}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {log.user ? `${log.user.name} · ${log.user.email}` : "System"}
                        </p>
                      </div>
                      <Badge variant={MODULE_BADGE[log.module] ?? "outline"}>{log.module}</Badge>
                    </div>
                    {log.entityId && (
                      <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">
                        entity: {log.entityId}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {fmt.dateTime(log.createdAt)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Entity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fmt.dateTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={MODULE_BADGE[log.module] ?? "outline"}>{log.module}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{log.action}</TableCell>
                        <TableCell>{log.user ? log.user.email : "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                          {log.entityId ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
