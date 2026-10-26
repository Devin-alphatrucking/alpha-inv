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
import { LogsFilters } from "@/app/(app)/admin/activity/logs-filters";
import { getFormat } from "@/lib/brand/brand";

const PAGE_SIZE = 50;

function statusVariant(status: number) {
  if (status >= 500) return "destructive" as const;
  if (status >= 400) return "secondary" as const;
  return "outline" as const;
}

type SearchParams = Promise<{ page?: string; q?: string; code?: string }>;

export default async function ErrorLogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session, db } = await pageOrg();
  const fmt = await getFormat();
  if (session.user.role !== "ADMIN") redirect(homeFor(session.user.role));

  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page ?? "1", 10) || 1)); // a bad ?page= never reaches the database
  const codeFilter = params.code || "";
  const q = params.q?.trim() || "";

  const and: Prisma.ApiErrorLogWhereInput[] = [];
  if (codeFilter) and.push({ errorCode: codeFilter });
  if (q) {
    and.push({
      OR: [
        { endpoint: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
        { requestId: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.ApiErrorLogWhereInput =
    and.length > 0 ? { AND: and } : {};

  const [total, logs, codes] = await Promise.all([
    db.apiErrorLog.count({ where }),
    db.apiErrorLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.apiErrorLog.groupBy({ by: ["errorCode"], _count: true }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Error logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Centralized API error records with internal codes and request ids.
        </p>
      </div>

      <LogsFilters
        filterOptions={codes.map((c) => ({ value: c.errorCode, label: c.errorCode, count: c._count }))}
        filterLabel="Code"
        filterParam="code"
        total={total}
        page={page}
        totalPages={totalPages}
        currentFilter={codeFilter}
        currentQuery={q}
      />

      <Card>
        <CardHeader>
          <CardTitle>Errors ({total})</CardTitle>
          <CardDescription>
            Page {page} of {totalPages} · newest first
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No errors match your filters.
            </p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">
                          {log.method} {log.endpoint}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fmt.dateTime(log.createdAt)}
                        </p>
                      </div>
                      <Badge variant={statusVariant(log.statusCode)}>{log.statusCode}</Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {log.errorCode}
                      </Badge>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {log.requestId}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{log.message}</p>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Request ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fmt.dateTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(log.statusCode)}>{log.statusCode}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">{log.errorCode}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{log.method}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs">
                          {log.endpoint}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate">{log.message}</TableCell>
                        <TableCell className="max-w-[140px] truncate font-mono text-[10px] text-muted-foreground">
                          {log.requestId}
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
