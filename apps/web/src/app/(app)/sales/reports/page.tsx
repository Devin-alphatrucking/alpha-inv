import { pageOrg } from "@/lib/org/page";
import { financialYear } from "@/lib/sales/rules";
import { companyToday } from "@/lib/flows/site";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Sales downloads" };

const FILES = [
  { kind: "b2b", title: "Invoices by tax rate (GSTR-1 style)", text: "One row per invoice and tax rate, with the customer's GSTIN, place of supply, taxable value and IGST / CGST / SGST. Type B2B has a GSTIN, B2C has none." },
  { kind: "hsn", title: "HSN / SAC summary", text: "Quantity, value and tax added up for each HSN or SAC code." },
  { kind: "invoices", title: "Invoice list", text: "One row per invoice with its totals and status." },
];

export default async function SalesDownloadsPage() {
  const { orgId } = await pageOrg();
  const today = await companyToday(orgId);
  const fy = financialYear(today);
  const from = `${fy.start}-04-01`;
  const to = `${fy.start + 1}-03-31`;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Downloads for your accountant</h1>
        <p className="text-sm text-muted-foreground">CSV files that open in Excel. Cancelled invoices are left out. The period starts as the current financial year ({fy.label}).</p>
      </div>
      <div className="grid gap-4">
        {FILES.map((f) => (
          <Card key={f.kind}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
              <CardDescription>{f.text}</CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/api/sales/export" method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="kind" value={f.kind} />
                <div className="grid gap-1.5">
                  <Label htmlFor={`from-${f.kind}`}>From</Label>
                  <Input id={`from-${f.kind}`} type="date" name="from" defaultValue={from} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`to-${f.kind}`}>To</Label>
                  <Input id={`to-${f.kind}`} type="date" name="to" defaultValue={to} required />
                </div>
                <Button type="submit">Download CSV</Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
