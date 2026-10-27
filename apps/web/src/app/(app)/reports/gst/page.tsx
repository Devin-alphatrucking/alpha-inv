import { hasPermission, homeFor } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, TriangleAlert } from "lucide-react";
import { pageOrg } from "@/lib/org/page";
import { getFormat } from "@/lib/brand/brand";
import { todayIn } from "@/lib/invoices/status";
import { loadGstInvoices } from "@/lib/gst/load";
import { buildGstReport, financialYearOf, financialYearRange, parsePeriod } from "@/lib/gst/report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = { title: "GST report" };

type Props = { searchParams: Promise<{ fy?: string; from?: string; to?: string; project?: string }> };

const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** Tax paid on purchases: by month and by supplier GSTIN, for filing and for your accountant. Administrators only. */
export default async function GstReportPage({ searchParams }: Props) {
  const { session, db } = await pageOrg();
  if (!hasPermission(session.user.role, "report:view")) redirect(homeFor(session.user.role));
  const sp = await searchParams;
  const fmt = await getFormat();
  const money = (minor: number) => fmt.money(minor / 100, 2);

  const today = todayIn(fmt.format.timeZone);
  const period = parsePeriod({ fy: sp.fy, from: sp.from, to: sp.to }, today);
  const projects = await db.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const project = projects.find((p) => p.id === sp.project) ?? null;

  const invoices = await loadGstInvoices(db, period, project?.id);
  const report = buildGstReport(invoices);
  const { totals } = report;

  const thisFy = financialYearOf(today);
  const years = Array.from({ length: 5 }, (_, k) => thisFy - k);
  const selectedFy = period.custom ? "" : String(financialYearOf(period.from));

  const query = (view: string) => {
    const p = new URLSearchParams({ view });
    if (period.custom) {
      p.set("from", period.from);
      p.set("to", period.to);
    } else p.set("fy", selectedFy);
    if (project) p.set("project", project.id);
    return `/api/reports/gst?${p.toString()}`;
  };

  const stat = (label: string, value: string, hint?: string) => (
    <Card>
      <CardHeader className="gap-1 p-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GST report</h1>
        <p className="text-sm text-muted-foreground">
          Tax on your purchases for {period.label}{project ? `, ${project.name}` : ", all projects"}. Only confirmed invoices are counted, by invoice date.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Financial year
              <NativeSelect name="fy" defaultValue={selectedFy}>
                {period.custom && <option value="">Custom dates</option>}
                {years.map((y) => (
                  <option key={y} value={y}>{financialYearRange(y).label}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Project
              <NativeSelect name="project" defaultValue={project?.id ?? ""}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" size="sm">Show</Button>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none py-2">Or pick exact dates</summary>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <label className="grid gap-1">From<Input type="date" name="from" defaultValue={period.custom ? period.from : ""} className="w-auto" /></label>
                <label className="grid gap-1">To<Input type="date" name="to" defaultValue={period.custom ? period.to : ""} className="w-auto" /></label>
                <span className="pb-2">Dates win over the financial year when both are filled in.</span>
              </div>
            </details>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Taxable value", money(totals.taxableMinor), `${totals.invoices} invoice${totals.invoices === 1 ? "" : "s"}`)}
        {stat("Total GST", money(totals.taxMinor), "CGST + SGST + IGST")}
        {stat("CGST + SGST", money(totals.cgstMinor + totals.sgstMinor), "same-state purchases")}
        {stat("IGST", money(totals.igstMinor), "other-state purchases")}
      </div>

      {(report.missingGstin.count > 0 || report.mismatched.length > 0 || report.invalidGstin.length > 0 || report.mixedTax.length > 0 || report.splitMismatch.length > 0) && (
        <Card className="border-amber-500/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><TriangleAlert className="size-4 text-amber-600" aria-hidden /> Worth checking before you file</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 p-4 pt-1 text-sm">
            {report.missingGstin.count > 0 && (
              <p>
                <strong>{report.missingGstin.count}</strong> invoice{report.missingGstin.count === 1 ? "" : "s"} with {money(report.missingGstin.taxMinor)} of GST {report.missingGstin.count === 1 ? "has" : "have"} a supplier with no GSTIN saved. Input credit cannot be claimed without it. Add the GSTIN on the <Link href="/vendors" className="underline underline-offset-4">Vendors</Link> page.
              </p>
            )}
            {report.invalidGstin.length > 0 && (
              <div>
                <p>
                  <strong>{report.invalidGstin.length}</strong> supplier{report.invalidGstin.length === 1 ? "" : "s"} {report.invalidGstin.length === 1 ? "has" : "have"} a GSTIN that is not valid, so it was probably misread or mistyped. Input credit will not match without the right number:
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {report.invalidGstin.slice(0, 8).map((v) => (
                    <li key={v.vendorId}>
                      <Link href={`/vendors/${v.vendorId}`} className="font-medium underline underline-offset-4">{v.name}</Link>{" "}
                      <span className="font-mono text-xs">{v.gstin}</span>{" "}
                      <span className="text-muted-foreground">({v.invoices} invoice{v.invoices === 1 ? "" : "s"}, {money(v.taxMinor)} GST): {v.reason}</span>
                    </li>
                  ))}
                </ul>
                {report.invalidGstin.length > 8 && <p className="mt-1 text-xs text-muted-foreground">and {report.invalidGstin.length - 8} more.</p>}
              </div>
            )}
            {report.mixedTax.length > 0 && (
              <div>
                <p><strong>{report.mixedTax.length}</strong> invoice{report.mixedTax.length === 1 ? "" : "s"} with IGST and CGST or SGST together. A purchase is either within the state or across states, never both:</p>
                <ul className="mt-1 grid gap-0.5">
                  {report.mixedTax.slice(0, 8).map((m) => (
                    <li key={m.id}>
                      <Link href={`/invoices/${m.id}`} className="font-medium underline underline-offset-4">{m.invoiceNumber}</Link> <span className="text-muted-foreground">{m.vendorName}</span>
                    </li>
                  ))}
                </ul>
                {report.mixedTax.length > 8 && <p className="mt-1 text-xs text-muted-foreground">and {report.mixedTax.length - 8} more.</p>}
              </div>
            )}
            {report.splitMismatch.length > 0 && (
              <div>
                <p><strong>{report.splitMismatch.length}</strong> invoice{report.splitMismatch.length === 1 ? "" : "s"} where CGST and SGST are not the same amount (they always are):</p>
                <ul className="mt-1 grid gap-0.5">
                  {report.splitMismatch.slice(0, 8).map((m) => (
                    <li key={m.id}>
                      <Link href={`/invoices/${m.id}`} className="font-medium underline underline-offset-4">{m.invoiceNumber}</Link> <span className="text-muted-foreground">{m.vendorName}: CGST {money(m.cgstMinor)}, SGST {money(m.sgstMinor)}</span>
                    </li>
                  ))}
                </ul>
                {report.splitMismatch.length > 8 && <p className="mt-1 text-xs text-muted-foreground">and {report.splitMismatch.length - 8} more.</p>}
              </div>
            )}
            {report.mismatched.length > 0 && (
              <div>
                <p><strong>{report.mismatched.length}</strong> invoice{report.mismatched.length === 1 ? "" : "s"} whose amounts do not add up (taxable value + GST + rounding is not the total):</p>
                <ul className="mt-1 grid gap-0.5">
                  {report.mismatched.slice(0, 8).map((m) => (
                    <li key={m.id}>
                      <Link href={`/invoices/${m.id}`} className="font-medium underline underline-offset-4">{m.invoiceNumber}</Link> <span className="text-muted-foreground">{m.vendorName}, off by {money(Math.abs(m.differenceMinor))}</span>
                    </li>
                  ))}
                </ul>
                {report.mismatched.length > 8 && <p className="mt-1 text-xs text-muted-foreground">and {report.mismatched.length - 8} more. The invoice-by-invoice download lists them all.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {totals.invoices === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No confirmed invoices dated in this period.</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">By month</CardTitle>
                <CardDescription>Month of the invoice date.</CardDescription>
              </div>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={query("months")} download />}><Download className="size-3.5" aria-hidden /> CSV</Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Taxable value</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                      <TableHead className="text-right">Total GST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{monthName(m.month)}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.invoices}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.taxableMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.cgstMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.sgstMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m.igstMinor)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(m.taxMinor)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{totals.invoices}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.taxableMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.cgstMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.sgstMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.igstMinor)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.taxMinor)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">By supplier</CardTitle>
                <CardDescription>Most tax first. Use these GSTINs when you check your input credit.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" nativeButton={false} render={<a href={query("vendors")} download />}><Download className="size-3.5" aria-hidden /> CSV</Button>
                <Button variant="outline" size="sm" nativeButton={false} render={<a href={query("invoices")} download />}><Download className="size-3.5" aria-hidden /> Every invoice</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Taxable value</TableHead>
                      <TableHead className="text-right">Total GST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.vendors.map((v) => (
                      <TableRow key={v.vendorId}>
                        <TableCell className="font-medium"><Link href={`/vendors/${v.vendorId}`} className="underline-offset-4 hover:underline">{v.name}</Link></TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {v.gstin ?? (v.taxMinor > 0 ? <Badge variant="destructive">Missing</Badge> : <span className="text-muted-foreground">none</span>)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{v.invoices}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(v.taxableMinor)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(v.taxMinor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
