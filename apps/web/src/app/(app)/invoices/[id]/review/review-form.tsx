"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  confirmInvoiceReview,
  createCategoryInline,
  createVendorInline,
  checkDuplicateInvoice,
} from "./actions";
import { InvoiceFilePreview } from "@/components/invoice-file-preview";
import { InvoicePaymentControls } from "@/app/(app)/invoices/invoice-payment-controls";
import { InvoiceDeleteButton } from "@/app/(app)/invoices/invoice-delete-button";
import { useFormat } from "@/components/format-provider";
import { lineKey, rateAlert, type RateBaseline } from "@/lib/invoices/rate-alerts";
import { checkGstin, hasValue } from "@/lib/gst/gstin";

export type ReviewVendor = { id: string; name: string; gstin: string | null };
export type ReviewCategory = { id: string; name: string; unit: string | null };
export type ReviewProject = { id: string; name: string };
export type ReviewLineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  rateExclGst: number;
  gstPercent: number;
  confidence?: number;
};

export type CustomTaxLine = {
  id: string;
  title: string;
  amount: number;
};

export type ReviewInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  vendorId: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string;
  subtotal: number;
  sgst: number;
  cgst: number;
  igst: number;
  total: number;
  customTaxes?: { id?: string; title: string; amount: number }[];
  fileUrl: string;
  status: string;
  paidAt: string | null;
  paidAmount: number;
  lineItems: ReviewLineItem[];
  vendor: ReviewVendor;
};

type Props = {
  invoice: ReviewInvoice;
  vendors: ReviewVendor[];
  categories: ReviewCategory[];
  projects: ReviewProject[];
  possibleDuplicate: boolean;
  /** What the company usually pays per item (keyed by lineKey), for the "rate is higher than usual" warnings. */
  rateBaselines: Record<string, RateBaseline>;
};

function toDateInput(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ReviewForm({
  invoice,
  vendors: initialVendors,
  categories: initialCategories,
  projects,
  possibleDuplicate,
  rateBaselines,
}: Props) {
  const fmt = useFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendors, setVendors] = useState(initialVendors);
  const [categories, setCategories] = useState(initialCategories);

  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber.toUpperCase());
  const [invoiceDate, setInvoiceDate] = useState(
    toDateInput(invoice.invoiceDate)
  );
  const [dueDate, setDueDate] = useState(toDateInput(invoice.dueDate));
  const [vendorId, setVendorId] = useState(invoice.vendorId);
  const [vendorName, setVendorName] = useState(invoice.vendor.name.toUpperCase());
  const [vendorGstin, setVendorGstin] = useState(
    (invoice.vendor.gstin ?? "").toUpperCase()
  );
  const [categoryId, setCategoryId] = useState(invoice.categoryId ?? "");
  const [projectId, setProjectId] = useState(invoice.projectId);
  const [subtotal, setSubtotal] = useState(invoice.subtotal);
  const [sgst, setSgst] = useState(invoice.sgst);
  const [cgst, setCgst] = useState(invoice.cgst);
  const [igst, setIgst] = useState(invoice.igst);
  const [customTaxes, setCustomTaxes] = useState<CustomTaxLine[]>(
    () =>
      invoice.customTaxes?.map((t, idx) => ({
        id: t.id || `ctax-${idx}-${Date.now()}`,
        title: (t.title || "").toUpperCase(),
        amount: Number(t.amount) || 0,
      })) ?? []
  );
  const [total, setTotal] = useState(invoice.total);
  const [lineItems, setLineItems] = useState(
    invoice.lineItems.map((li) => ({
      ...li,
      description: li.description.toUpperCase(),
      unit: li.unit.toUpperCase(),
      createMaterial: false,
    }))
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [dupWarning, setDupWarning] = useState(possibleDuplicate);

  const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

  const getCustomTaxesSum = (taxes: CustomTaxLine[]) =>
    taxes.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  function handleSubtotalChange(val: number) {
    setSubtotal(val);
    setTotal(round2(val + sgst + cgst + igst + getCustomTaxesSum(customTaxes)));
  }

  function handleSgstChange(val: number) {
    setSgst(val);
    setCgst(val);
    setTotal(round2(subtotal + val * 2 + igst + getCustomTaxesSum(customTaxes)));
  }

  function handleCgstChange(val: number) {
    setCgst(val);
    setSgst(val);
    setTotal(round2(subtotal + val * 2 + igst + getCustomTaxesSum(customTaxes)));
  }

  function handleIgstChange(val: number) {
    setIgst(val);
    setTotal(round2(subtotal + sgst + cgst + val + getCustomTaxesSum(customTaxes)));
  }

  function handleTotalChange(val: number) {
    setTotal(val);
  }

  function addCustomTax() {
    setCustomTaxes((prev) => [
      ...prev,
      {
        id: `ctax-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        title: "",
        amount: 0,
      },
    ]);
  }

  function updateCustomTax(id: string, patch: Partial<CustomTaxLine>) {
    setCustomTaxes((prev) => {
      const next = prev.map((t) => {
        if (t.id !== id) return t;
        const updated = { ...t, ...patch };
        if (patch.title !== undefined) {
          updated.title = patch.title.toUpperCase();
        }
        return updated;
      });
      setTotal(round2(subtotal + sgst + cgst + igst + getCustomTaxesSum(next)));
      return next;
    });
  }

  function removeCustomTax(id: string) {
    setCustomTaxes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setTotal(round2(subtotal + sgst + cgst + igst + getCustomTaxesSum(next)));
      return next;
    });
  }

  async function onInvoiceNumberChange(val: string) {
    const upper = val.toUpperCase();
    setInvoiceNumber(upper);
    if (vendorId && upper.trim()) {
      const dup = await checkDuplicateInvoice(vendorId, upper, invoice.id);
      setDupWarning(Boolean(dup));
    }
  }

  // A GSTIN the AI misread usually fails its check character: say so while the person can still fix it. Never blocks saving.
  const gstinCheck = hasValue(vendorGstin) ? checkGstin(vendorGstin) : null;
  const gstinProblem = gstinCheck && !gstinCheck.ok ? `This does not look like a valid GSTIN. ${gstinCheck.reason} Check it against the bill.` : null;
  const gstinState = gstinCheck?.ok ? gstinCheck.state : null;

  const lowConfidenceCount = useMemo(
    () => lineItems.filter((li) => (li.confidence ?? 1) < 0.7).length,
    [lineItems]
  );

  // Judged live, so a corrected rate clears its warning at once.
  const alertFor = (li: { description: string; unit: string; rateExclGst: number }) => {
    const baseline = rateBaselines[lineKey(li.description, li.unit)];
    const alert = rateAlert(li.rateExclGst, baseline);
    return alert && baseline ? { alert, baseline } : null;
  };
  const rateAlertCount = lineItems.filter((li) => {
    const found = alertFor(li);
    return found !== null && found.alert.level !== "low";
  }).length;

  function updateLine(
    index: number,
    patch: Partial<(typeof lineItems)[number]>
  ) {
    setLineItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function addLine() {
    setLineItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        description: "",
        quantity: 1,
        unit: "NOS",
        rateExclGst: 0,
        gstPercent: 0,
        createMaterial: false,
      },
    ]);
  }

  function removeLine(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    try {
      const created = await createCategoryInline({ name: newCategoryName });
      setCategories((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setCategoryId(created.id);
      setNewCategoryName("");
      toast.success(`Category “${created.name}” created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create category");
    }
  }

  async function handleCreateVendor() {
    try {
      const created = await createVendorInline({
        name: vendorName,
        gstin: vendorGstin || null,
      });
      setVendors((prev) => {
        if (prev.some((v) => v.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setVendorId(created.id);
      setVendorName(created.name);
      setVendorGstin(created.gstin ?? "");
      toast.success(`Vendor “${created.name}” saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save vendor");
    }
  }

  async function onVendorSelect(id: string) {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id);
    if (v) {
      setVendorName(v.name.toUpperCase());
      setVendorGstin((v.gstin ?? "").toUpperCase());
      const dup = await checkDuplicateInvoice(id, invoiceNumber, invoice.id);
      setDupWarning(Boolean(dup));
    }
  }

  function handleConfirm() {
    if (dupWarning) {
      toast.error(
        `Invoice number "${invoiceNumber}" already exists for this vendor. Duplicate invoice numbers are not allowed.`
      );
      return;
    }

    startTransition(async () => {
      try {
        const result = await confirmInvoiceReview({
          invoiceId: invoice.id,
          invoiceNumber: invoiceNumber.trim().toUpperCase(),
          invoiceDate,
          dueDate: dueDate || null,
          vendorId,
          vendorName: vendorName.trim().toUpperCase(),
          vendorGstin: vendorGstin ? vendorGstin.trim().toUpperCase() : null,
          categoryId: categoryId || null,
          projectId,
          subtotal,
          sgst,
          cgst,
          igst,
          customTaxes: customTaxes
            .filter((t) => t.title.trim())
            .map((t) => ({
              id: t.id,
              title: t.title.trim().toUpperCase(),
              amount: Number(t.amount) || 0,
            })),
          total,
          lineItems: lineItems.map((li) => ({
            id: li.id,
            description: li.description.trim().toUpperCase(),
            quantity: li.quantity,
            unit: li.unit.trim().toUpperCase(),
            rateExclGst: li.rateExclGst,
            gstPercent: li.gstPercent,
            createMaterial: li.createMaterial,
          })),
        });

        if (result && "ok" in result && result.ok && result.redirectUrl) {
          const wasDraft =
            invoice.status === "NEEDS_REVIEW" || invoice.status === "PROCESSING";
          toast.success(wasDraft ? "Invoice confirmed and saved" : "Invoice updated");
          router.push(result.redirectUrl);
          router.refresh();
          return;
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to confirm invoice"
        );
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs font-medium"
          onClick={() => router.push("/invoices")}
        >
          <ArrowLeft className="size-4" />
          <span>Back to invoices</span>
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.status === "NEEDS_REVIEW" || invoice.status === "PROCESSING"
              ? "Review extracted invoice"
              : "Edit invoice"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update invoice details, category, totals, and line items.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dupWarning && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" />
              Duplicate Invoice #
            </Badge>
          )}
          <Badge variant="secondary">{invoice.status.replace("_", " ")}</Badge>
          {rateAlertCount > 0 && (
            <Badge variant="outline" className="gap-1 border-red-500/50 text-red-600">
              <AlertTriangle className="size-3" />
              {rateAlertCount} rate{rateAlertCount === 1 ? "" : "s"} above usual
            </Badge>
          )}
          {lowConfidenceCount > 0 && (
            <Badge variant="outline" className="gap-1 text-amber-700">
              <AlertTriangle className="size-3" />
              {lowConfidenceCount} low-confidence line(s)
            </Badge>
          )}
        </div>
      </div>

      {dupWarning && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive dark:border-destructive/60 dark:bg-destructive/15">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-base">Duplicate Invoice Code Error</p>
            <p className="text-destructive/90 text-sm">
              Another invoice with number <strong>&ldquo;{invoiceNumber}&rdquo;</strong> already exists for the selected vendor.
              Duplicate invoice codes are not allowed. Please modify the invoice number before saving.
            </p>
          </div>
        </div>
      )}

      <Card className="transition-shadow duration-200 hover:shadow-sm">
        <CardHeader>
          <CardTitle>Header</CardTitle>
          <CardDescription>Vendor, dates, and category</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="vendorSelect">Match vendor</Label>
            <Select
              value={vendorId}
              onValueChange={(value) => {
                if (value) void onVendorSelect(value);
              }}
              items={vendors.map((v) => ({
                value: v.id,
                label: v.gstin ? `${v.name} (${v.gstin})` : v.name,
              }))}
            >
              <SelectTrigger id="vendorSelect" className="w-full">
                <SelectValue placeholder="Select vendor…" />
              </SelectTrigger>
              <SelectContent align="start">
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.gstin ? ` (${v.gstin})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vendorName">Vendor name</Label>
            <Input
              id="vendorName"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value.toUpperCase())}
              className="uppercase"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vendorGstin">GSTIN</Label>
            <Input
              id="vendorGstin"
              value={vendorGstin}
              onChange={(e) => setVendorGstin(e.target.value.toUpperCase())}
              className="uppercase"
              aria-invalid={gstinProblem ? true : undefined}
              aria-describedby="vendorGstin-note"
            />
            <p id="vendorGstin-note" className={`text-xs ${gstinProblem ? "text-red-600" : "text-muted-foreground"}`} role={gstinProblem ? "alert" : undefined}>
              {gstinProblem ?? (gstinState ? `Valid GSTIN: ${gstinState}.` : "")}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCreateVendor()}>
              Save / create vendor from fields above
            </Button>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invoiceNumber">Invoice #</Label>
            <Input
              id="invoiceNumber"
              value={invoiceNumber}
              onChange={(e) => void onInvoiceNumberChange(e.target.value)}
              className="uppercase"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="projectId">Project</Label>
            <Select
              value={projectId}
              onValueChange={(value) => {
                if (value) setProjectId(value);
              }}
              items={projects.map((p) => ({ value: p.id, label: p.name }))}
            >
              <SelectTrigger id="projectId" className="w-full">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent align="start">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invoiceDate">Invoice date</Label>
            <DatePicker
              id="invoiceDate"
              value={invoiceDate}
              onChange={setInvoiceDate}
              placeholder="Select invoice date"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dueDate">Due date</Label>
            <DatePicker
              id="dueDate"
              value={dueDate}
              onChange={setDueDate}
              placeholder="Select due date (optional)"
            />
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="categoryId">Category</Label>
            <Select
              value={categoryId || null}
              onValueChange={(value) => setCategoryId(value ?? "")}
              items={categories.map((c) => ({ value: c.id, label: c.name }))}
            >
              <SelectTrigger id="categoryId" className="w-full">
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent align="start">
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="newCategory">Create category (STAFF allowed)</Label>
              <Input
                id="newCategory"
                placeholder="e.g. Electrical"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleCreateCategory()}
            >
              <Plus className="size-4" />
              Add category
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="transition-shadow duration-200 hover:shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Line items</CardTitle>
            <CardDescription>Edit quantities, rates, and descriptions</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="size-4" />
            Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mobile: stacked cards */}
          <div className="space-y-3 md:hidden">
            {lineItems.map((li, index) => (
              <div
                key={li.id}
                className="space-y-3 rounded-lg border bg-muted/20 p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Line {index + 1}
                    {li.confidence != null && li.confidence < 0.7 && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {(li.confidence * 100).toFixed(0)}% conf
                      </Badge>
                    )}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeLine(index)}
                    disabled={lineItems.length <= 1}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Input
                  placeholder="Description"
                  value={li.description}
                  onChange={(e) =>
                    updateLine(index, { description: e.target.value.toUpperCase() })
                  }
                  className="uppercase"
                />
                <RateNote found={alertFor(li)} money={(n) => fmt.money(n, 2)} />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={li.quantity === 0 ? "" : li.quantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      updateLine(index, {
                        quantity: e.target.value === "" ? 0 : Number(e.target.value),
                      })
                    }
                  />
                  <Input
                    placeholder="Unit"
                    value={li.unit}
                    onChange={(e) => updateLine(index, { unit: e.target.value.toUpperCase() })}
                    className="uppercase"
                  />
                  <Input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={li.rateExclGst === 0 ? "" : li.rateExclGst}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      updateLine(index, {
                        rateExclGst: e.target.value === "" ? 0 : Number(e.target.value),
                      })
                    }
                  />
                  <Input
                    type="number"
                    step="any"
                    placeholder="0"
                    value={li.gstPercent === 0 ? "" : li.gstPercent}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      updateLine(index, {
                        gstPercent: e.target.value === "" ? 0 : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={li.createMaterial}
                    onChange={(e) =>
                      updateLine(index, { createMaterial: e.target.checked })
                    }
                  />
                  Create material if unmatched
                </label>
              </div>
            ))}
          </div>

          {/* Desktop: table with horizontal scroll fallback */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-2 font-medium">Description</th>
                  <th className="pb-2 pr-2 font-medium">Qty</th>
                  <th className="pb-2 pr-2 font-medium">Unit</th>
                  <th className="pb-2 pr-2 font-medium">Rate</th>
                  <th className="pb-2 pr-2 font-medium">GST %</th>
                  <th className="pb-2 pr-2 font-medium">Material</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, index) => (
                  <tr key={li.id} className="border-b border-border/60">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={li.description}
                          onChange={(e) =>
                            updateLine(index, { description: e.target.value.toUpperCase() })
                          }
                          className="uppercase"
                        />
                        {li.confidence != null && li.confidence < 0.7 && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {(li.confidence * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                      <RateNote found={alertFor(li)} money={(n) => fmt.money(n, 2)} />
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <Input
                        type="number"
                        step="any"
                        placeholder="0"
                        value={li.quantity === 0 ? "" : li.quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateLine(index, {
                            quantity: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <Input
                        placeholder="NOS"
                        value={li.unit}
                        onChange={(e) =>
                          updateLine(index, { unit: e.target.value.toUpperCase() })
                        }
                        className="uppercase"
                      />
                    </td>
                    <td className="py-2 pr-2 w-28">
                      <Input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={li.rateExclGst === 0 ? "" : li.rateExclGst}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateLine(index, {
                            rateExclGst: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <Input
                        type="number"
                        step="any"
                        placeholder="0"
                        value={li.gstPercent === 0 ? "" : li.gstPercent}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateLine(index, {
                            gstPercent: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={li.createMaterial}
                          onChange={(e) =>
                            updateLine(index, {
                              createMaterial: e.target.checked,
                            })
                          }
                        />
                        Create
                      </label>
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeLine(index)}
                        disabled={lineItems.length <= 1}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totals &amp; Taxes</CardTitle>
          <CardDescription>Review subtotal, standard GST, and custom charges</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Main Subtotal and Default Taxes */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label>Subtotal</Label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={subtotal === 0 ? "" : subtotal}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleSubtotalChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>SGST</Label>
                <span className="text-[10px] text-muted-foreground font-medium">(Auto-sync)</span>
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={sgst === 0 ? "" : sgst}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleSgstChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>CGST</Label>
                <span className="text-[10px] text-muted-foreground font-medium">(Auto-sync)</span>
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={cgst === 0 ? "" : cgst}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleCgstChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>IGST</Label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={igst === 0 ? "" : igst}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleIgstChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
            </div>
          </div>

          {/* Custom / Additional Taxes & Charges Section */}
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">Additional Taxes &amp; Charges</p>
                <p className="text-[11px] text-muted-foreground">Add specific taxes (e.g. TDS, Cess, Freight GST, RCM, TCS) for this invoice</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomTax}
                className="h-8 gap-1.5 text-xs rounded-lg font-medium"
              >
                <Plus className="size-3.5" />
                Add Tax / Charge
              </Button>
            </div>

            {customTaxes.length > 0 && (
              <div className="space-y-2 pt-1">
                {customTaxes.map((tax) => (
                  <div key={tax.id} className="flex items-center gap-2">
                    <Input
                      placeholder="Tax Title (e.g. TDS, CESS, FREIGHT)"
                      value={tax.title}
                      onChange={(e) => updateCustomTax(tax.id, { title: e.target.value })}
                      className="h-9 flex-1 uppercase text-xs"
                    />
                    <div className="w-36">
                      <Input
                        type="number"
                        step="any"
                        placeholder={`Amount (${fmt.symbol})`}
                        value={tax.amount === 0 ? "" : tax.amount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          updateCustomTax(tax.id, {
                            amount: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                        className="h-9 text-xs"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeCustomTax(tax.id)}
                      className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                      title="Remove tax line"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Final Total Amount */}
          <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-4 border border-border/60 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-semibold">Total Amount ({fmt.symbol})</Label>
              <p className="text-xs text-muted-foreground">Calculated with subtotal, standard GST and additional charges</p>
            </div>
            <div className="w-full sm:w-48">
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={total === 0 ? "" : total}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  handleTotalChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
                className="h-11 text-base font-bold"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <InvoiceDeleteButton
          invoiceId={invoice.id}
          invoiceNumber={invoiceNumber}
          vendorName={vendorName}
          variant="button"
          redirectTo="/invoices"
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/invoices")}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending
              ? "Saving…"
              : invoice.status === "NEEDS_REVIEW" || invoice.status === "PROCESSING"
                ? "Confirm & save invoice"
                : "Save invoice changes"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source file</CardTitle>
          <CardDescription>
            Uploaded invoice document — preview with zoom, or open in a new tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InvoiceFilePreview
            invoiceId={invoice.id}
            fileUrl={invoice.fileUrl}
          />
          <InvoicePaymentControls
            invoiceId={invoice.id}
            status={invoice.status}
            paidAt={invoice.paidAt}
            invoiceNumber={invoiceNumber}
            vendorName={
              vendors.find((v) => v.id === vendorId)?.name ??
              invoice.vendor.name
            }
            categoryName={
              categories.find((c) => c.id === categoryId)?.name ??
              invoice.categoryName
            }
            total={total}
            paidAmount={invoice.paidAmount}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** The warning line under an item whose rate is far from what the company usually pays. */
function RateNote({ found, money }: { found: { alert: NonNullable<ReturnType<typeof rateAlert>>; baseline: RateBaseline } | null; money: (n: number) => string }) {
  if (!found) return null;
  const { alert, baseline } = found;
  const high = alert.level !== "low";
  const tone = alert.level === "very-high" ? "text-red-600" : alert.level === "high" ? "text-amber-600" : "text-sky-600";
  return (
    <p className={`mt-1 flex items-start gap-1 text-xs ${tone}`} role="note">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>
        <strong>
          {Math.abs(Math.round(alert.percent))}% {high ? "above" : "below"} your usual rate
        </strong>{" "}
        of {money(alert.usual)} ({baseline.count} earlier purchases; last {money(baseline.lastRate)} from {baseline.lastVendor} on {baseline.lastDate}).
        {high ? " Check the rate, quantity and unit before you save." : " Check that the unit and quantity are right."}
      </span>
    </p>
  );
}
