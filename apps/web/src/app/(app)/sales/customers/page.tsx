import { pageOrg } from "@/lib/org/page";
import { listCustomers } from "@/lib/flows/sales";
import { hasPermission } from "@/lib/roles";
import { GST_STATES } from "@/lib/gst/gstin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerForm } from "./customer-form";

export const metadata = { title: "Sales customers" };

export default async function CustomersPage() {
  const { user } = await pageOrg();
  const list = await listCustomers(user);
  if (!list.ok) return <p className="text-sm text-destructive">{list.error}</p>;
  const stateName = (code: string | null) => (code ? `${code} - ${GST_STATES[code] ?? code}` : "-");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">The people and companies you invoice. These are separate from your suppliers.</p>
      </div>
      {hasPermission(user.role, "sales:write") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add customer</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerForm />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All customers ({list.customers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {list.customers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No customers yet. Add your first one above.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {list.customers.map((c) => (
                  <div key={c.id} className="space-y-1 rounded-xl border bg-card p-3.5 shadow-sm">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.gstin ? `GSTIN ${c.gstin} · ` : ""}{stateName(c.stateCode)}</p>
                    <p className="text-xs text-muted-foreground">{c.invoiceCount} invoice{c.invoiceCount === 1 ? "" : "s"}</p>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.customers.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.gstin ?? "-"}</TableCell>
                        <TableCell>{stateName(c.stateCode)}</TableCell>
                        <TableCell>{c.phone ?? "-"}</TableCell>
                        <TableCell className="text-right">{c.invoiceCount}</TableCell>
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
