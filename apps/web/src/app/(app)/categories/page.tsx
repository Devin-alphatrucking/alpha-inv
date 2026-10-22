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
import { createCategory } from "./actions";
import { ActionForm } from "@/components/action-form";

export default async function CategoriesPage() {
  const { db } = await pageOrg();
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { materials: true, invoices: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Material categories — Plumbing, Steel, Cement, Tiles, and so on.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add category</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createCategory} submitLabel="Add category" successMessage="Category added" className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unit">Default unit</Label>
              <Input id="unit" name="unit" placeholder="NOS, BAG, KG..." />
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All categories ({categories.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No categories yet. Add your first category above.
            </p>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="space-y-3 md:hidden">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className="rounded-xl border bg-card p-3.5 shadow-sm space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground">
                        {category.name}
                      </p>
                      {category.unit && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground">
                          {category.unit}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/60">
                      <span>{category._count.materials} material(s)</span>
                      <span>{category._count.invoices} invoice(s)</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View: Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Default unit</TableHead>
                      <TableHead className="text-right">Materials</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell>{category.unit ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {category._count.materials}
                        </TableCell>
                        <TableCell className="text-right">
                          {category._count.invoices}
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
