import Link from "next/link";
import { Button } from "@/components/ui/button";
import { pageOrg } from "@/lib/org/page";
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
import { getFormat } from "@/lib/brand/brand";

export default async function MaterialsPage() {
  const { db } = await pageOrg();
  const fmt = await getFormat();
  const formatCurrency = (value: number, maxFraction = 2) => fmt.money(value, maxFraction);
  const materials = await db.material.findMany({
    include: {
      category: true,
      lineItems: {
        select: {
          rateExclGst: true,
          gstPercent: true,
          invoice: { select: { invoiceDate: true } },
        },
      },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });

  const rows = materials.map((material) => {
    const rates = material.lineItems.map(
      (item) =>
        Number(item.rateExclGst) * (1 + Number(item.gstPercent) / 100)
    );
    const avgRateInclGst =
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    const lastPurchased = material.lineItems.reduce<Date | null>(
      (latest, item) =>
        !latest || item.invoice.invoiceDate > latest
          ? item.invoice.invoiceDate
          : latest,
      null
    );

    return {
      id: material.id,
      name: material.name,
      category: material.category.name,
      unit: material.defaultUnit,
      avgRateInclGst,
      purchaseCount: material.lineItems.length,
      lastPurchased,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Rate Sheet</h1>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/materials/compare" />}>
            Compare suppliers&apos; prices
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Live average rate per material, computed from every recorded
          invoice line item — always current.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Materials ({rows.length})</CardTitle>
          <CardDescription>
            Grouped by category, mirroring the original RATE SHEET tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No materials yet. Materials are created automatically from
              invoice line items, or you can pre-seed them.
            </p>
          ) : (
            <>
              {/* Mobile View: Cards */}
              <div className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border bg-card p-3.5 shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-foreground">
                          {row.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.category} · {row.unit}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-sm tabular-nums text-foreground">
                          {row.avgRateInclGst !== null
                            ? formatCurrency(row.avgRateInclGst)
                            : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Avg incl. GST
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-border/60 text-muted-foreground">
                      <span>{row.purchaseCount} purchase(s)</span>
                      <span>
                        Last:{" "}
                        {row.lastPurchased
                          ? fmt.date(row.lastPurchased)
                          : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View: Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Avg rate (incl. GST)</TableHead>
                      <TableHead className="text-right">Purchases</TableHead>
                      <TableHead>Last purchased</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">
                          {row.category}
                        </TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.unit}</TableCell>
                        <TableCell className="text-right">
                          {row.avgRateInclGst !== null
                            ? formatCurrency(row.avgRateInclGst)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.purchaseCount}
                        </TableCell>
                        <TableCell>
                          {row.lastPurchased
                            ? fmt.date(row.lastPurchased)
                            : "—"}
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
