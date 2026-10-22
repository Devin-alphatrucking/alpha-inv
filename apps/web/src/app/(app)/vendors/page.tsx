import { pageOrg } from "@/lib/org/page";
import {
  Card,
  CardContent,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createVendor } from "./actions";
import { ActionForm } from "@/components/action-form";

export default async function VendorsPage() {
  const { db } = await pageOrg();
  const vendors = await db.vendor.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
        <p className="text-sm text-muted-foreground">
          Suppliers you purchase construction materials from.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add vendor</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createVendor} submitLabel="Add vendor" successMessage="Vendor added" className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" name="gstin" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact">Contact</Label>
              <Input id="contact" name="contact" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All vendors ({vendors.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No vendors yet. Add your first vendor above.
            </p>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="space-y-3 md:hidden">
                {vendors.map((vendor) => (
                  <div
                    key={vendor.id}
                    className="rounded-xl border bg-card p-3.5 shadow-sm space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground">
                        {vendor.name}
                      </p>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {vendor._count.invoices} invoice(s)
                      </span>
                    </div>
                    {vendor.gstin && (
                      <p className="text-xs text-muted-foreground">
                        GSTIN: <span className="font-mono text-foreground">{vendor.gstin}</span>
                      </p>
                    )}
                    {vendor.contact && (
                      <p className="text-xs text-muted-foreground">
                        Contact: {vendor.contact}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop View: Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map((vendor) => (
                      <TableRow key={vendor.id}>
                        <TableCell className="font-medium">{vendor.name}</TableCell>
                        <TableCell>{vendor.gstin ?? "—"}</TableCell>
                        <TableCell>{vendor.contact ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {vendor._count.invoices}
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
