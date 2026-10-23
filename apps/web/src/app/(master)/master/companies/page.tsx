import Link from "next/link";
import { listCompanies, PAGE_SIZE } from "@/lib/master/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompanyStatusBadge, FilterBar, PageTitle, Pager, StateBadge, STATE_LABEL, fmtDate } from "../master-ui";
import type { PlanState } from "@/lib/plans/rules";

export const metadata = { title: "Companies | Master console" };
export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; state?: string; page?: string }>;

export default async function CompaniesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const state = sp.state && sp.state in STATE_LABEL ? sp.state : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, counts, capped } = await listCompanies({ q, state, page });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title="Companies">Search every company, then open one to see and change its plan, people and billing.</PageTitle>
        <Link href="/master/companies/new" className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Set up a company
        </Link>
      </div>

      <FilterBar action="/master/companies">
        <div className="grid gap-1.5">
          <label htmlFor="q" className="text-xs text-muted-foreground">Name or code</label>
          <Input id="q" name="q" defaultValue={q} placeholder="Search" className="w-56" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="state" className="text-xs text-muted-foreground">Plan state</label>
          <select id="state" name="state" defaultValue={state} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">All states</option>
            {(Object.keys(STATE_LABEL) as PlanState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABEL[s].label}{counts[s] ? ` (${counts[s]})` : ""}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      {capped && <p className="text-sm text-amber-600">Showing the newest 5000 companies only. Narrow the search.</p>}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No companies match.</p>
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {rows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/master/companies/${c.id}`} className="grid gap-1 p-4 hover:bg-muted/40">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        <StateBadge state={c.state} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.slug} · {c.quantity} plan{c.quantity === 1 ? "" : "s"} · {c.projects} project{c.projects === 1 ? "" : "s"} · {c.members} people
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Plan state</TableHead>
                      <TableHead className="text-right">Plans</TableHead>
                      <TableHead className="text-right">Projects</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/master/companies/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{c.slug}</p>
                        </TableCell>
                        <TableCell className="space-x-1.5 whitespace-nowrap">
                          <StateBadge state={c.state} />
                          {c.status !== "ACTIVE" && c.status !== "TRIAL" && <CompanyStatusBadge status={c.status} />}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.projects}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.members}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.billing === "RAZORPAY" ? "Razorpay" : "By hand"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Pager basePath="/master/companies" params={{ q, state }} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
