import Link from "next/link";
import { listActivity, listErrors } from "@/lib/master/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FilterBar, PageTitle, Pager, fmtDateTime } from "../master-ui";
import { NativeSelect } from "@/components/ui/native-select";

export const metadata = { title: "Logs | Master console" };
export const dynamic = "force-dynamic";

type SP = Promise<{ tab?: string; q?: string; module?: string; code?: string; org?: string; page?: string }>;

export default async function LogsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tab = sp.tab === "errors" ? "errors" : "activity";
  const q = sp.q?.trim() ?? "";
  const org = sp.org?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const moduleFilter = sp.module ?? "";
  const code = sp.code ?? "";

  const tabLink = (t: string, label: string) => (
    <Link href={`/master/logs?tab=${t}${org ? `&org=${org}` : ""}`} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageTitle title="Logs">Everything that happened and every error, across all companies. Times are UTC.</PageTitle>
      <div className="flex gap-1">
        {tabLink("activity", "Activity")}
        {tabLink("errors", "Errors")}
      </div>
      {org && (
        <p className="text-sm text-muted-foreground">
          Showing one company only.{" "}
          <Link href={`/master/logs?tab=${tab}`} className="underline underline-offset-4">
            Show all companies
          </Link>
        </p>
      )}

      {tab === "activity" ? <Activity q={q} module={moduleFilter} org={org} page={page} /> : <Errors q={q} code={code} org={org} page={page} />}
    </>
  );
}

async function Activity({ q, module, org, page }: { q: string; module: string; org: string; page: number }) {
  const r = await listActivity({ q, module, orgId: org || undefined, page });
  return (
    <>
      <FilterBar action="/master/logs">
        <input type="hidden" name="tab" value="activity" />
        {org && <input type="hidden" name="org" value={org} />}
        <div className="grid gap-1.5">
          <label htmlFor="q" className="text-xs text-muted-foreground">Search action, entity or person</label>
          <Input id="q" name="q" defaultValue={q} className="w-64" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="module" className="text-xs text-muted-foreground">Module</label>
          <NativeSelect id="module" name="module" defaultValue={module}>
            <option value="">All modules</option>
            {r.modules.map((m) => (
              <option key={m.value} value={m.value}>
                {m.value} ({m.count})
              </option>
            ))}
          </NativeSelect>
        </div>
      </FilterBar>
      <Card>
        <CardContent className="p-0">
          {r.rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No activity matches.</p>
          ) : (
            <ul className="divide-y text-sm">
              {r.rows.map((a) => (
                <li key={a.id} className="grid gap-1 p-3 sm:px-4">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant={a.module === "MASTER" ? "default" : "outline"}>{a.module}</Badge>
                      <span className="font-mono text-xs font-semibold">{a.action}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.user?.email ?? "system"}
                    {a.organizationId && (
                      <>
                        {" · "}
                        <Link href={`/master/companies/${a.organizationId}`} className="underline-offset-4 hover:underline">
                          {r.orgNames.get(a.organizationId) ?? a.organizationId}
                        </Link>
                      </>
                    )}
                    {a.details && typeof a.details === "object" && "reason" in a.details ? ` · reason: ${String((a.details as { reason: unknown }).reason)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager basePath="/master/logs" params={{ tab: "activity", q, module, org }} page={page} total={r.total} pageSize={50} />
    </>
  );
}

async function Errors({ q, code, org, page }: { q: string; code: string; org: string; page: number }) {
  const r = await listErrors({ q, code, orgId: org || undefined, page });
  return (
    <>
      <FilterBar action="/master/logs">
        <input type="hidden" name="tab" value="errors" />
        {org && <input type="hidden" name="org" value={org} />}
        <div className="grid gap-1.5">
          <label htmlFor="q" className="text-xs text-muted-foreground">Search message, endpoint or request id</label>
          <Input id="q" name="q" defaultValue={q} className="w-64" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="code" className="text-xs text-muted-foreground">Error code</label>
          <NativeSelect id="code" name="code" defaultValue={code}>
            <option value="">All codes</option>
            {r.codes.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value} ({c.count})
              </option>
            ))}
          </NativeSelect>
        </div>
      </FilterBar>
      <Card>
        <CardContent className="p-0">
          {r.rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No errors match.</p>
          ) : (
            <ul className="divide-y text-sm">
              {r.rows.map((e) => (
                <li key={e.id} className="grid gap-1 p-3 sm:px-4">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant={e.statusCode >= 500 ? "destructive" : "secondary"}>{e.statusCode}</Badge>
                      <span className="font-mono text-xs font-semibold">{e.errorCode}</span>
                      <span className="font-mono text-xs text-muted-foreground">{e.method} {e.endpoint}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
                  </span>
                  <span className="break-words">{e.message}</span>
                  <span className="text-xs text-muted-foreground">
                    request {e.requestId}
                    {e.organizationId && (
                      <>
                        {" · "}
                        <Link href={`/master/companies/${e.organizationId}`} className="underline-offset-4 hover:underline">
                          {r.orgNames.get(e.organizationId) ?? e.organizationId}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager basePath="/master/logs" params={{ tab: "errors", q, code, org }} page={page} total={r.total} pageSize={50} />
    </>
  );
}
