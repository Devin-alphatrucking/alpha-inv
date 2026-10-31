import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ApiError, type InvoiceDetailResponse } from "@/lib/client";
import { day, money, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Card, ErrorBox, Loading, Muted } from "@/components/ui";
import { PaymentCard } from "@/components/payment-card";

export default function InvoiceScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, me } = useSession();
  const fmt = me?.company.brand?.format;
  const [data, setData] = useState<InvoiceDetailResponse | null>(null);
  const [file, setFile] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await client.invoice(String(id));
      setData(r);
      // The original is shown only when it is a photo; a PDF is read through the website's viewer.
      setFile(await client.fileSource(r.fileUrl));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this invoice.");
    }
  }, [client, id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading />;
  const i = data.invoice;
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
      <Muted>{label}</Muted>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>{value}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: t.text }}>{i.vendor.name}</Text>
            <Muted>{i.invoiceNumber}{i.vendor.gstin ? ` · GSTIN ${i.vendor.gstin}` : ""}</Muted>
          </View>
          <Badge label={STATUS_LABEL[i.status] ?? i.status} tone={i.status === "PAID" ? "ok" : i.status === "OVERDUE" ? "danger" : "warn"} />
        </View>
        <Text style={{ fontSize: 30, fontWeight: "800", color: t.text }}>{money(i.total, fmt)}</Text>
        {row("Project", i.project.name)}
        {i.category ? row("Category", i.category.name) : null}
        {row("Invoice date", day(i.invoiceDate, fmt))}
        {i.dueDate ? row("Due", day(i.dueDate, fmt)) : null}
        {i.paidAt ? row("Paid on", day(i.paidAt, fmt)) : null}
        {i.paymentTerms ? row("Terms", i.paymentTerms) : null}
        {i.status === "NEEDS_REVIEW" ? <Muted>This invoice was read automatically and still needs to be checked on the website before it is final.</Muted> : null}
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.text }}>Amounts</Text>
        {row("Subtotal", money(i.subtotal, fmt))}
        {Number(i.cgst) ? row("CGST", money(i.cgst, fmt)) : null}
        {Number(i.sgst) ? row("SGST", money(i.sgst, fmt)) : null}
        {Number(i.igst) ? row("IGST", money(i.igst, fmt)) : null}
        {Number(i.rounding) ? row("Rounding", money(i.rounding, fmt)) : null}
        {row("Total", money(i.total, fmt))}
      </Card>

      {i.status !== "NEEDS_REVIEW" && i.status !== "PROCESSING" ? (
        <PaymentCard key={`${i.payments.length}-${data.balance}`} invoiceId={i.id} payments={i.payments} paid={data.paid} balance={data.balance} canPay={data.canPay} onSaved={load} />
      ) : null}

      {i.lineItems.length > 0 && (
        <Card style={{ gap: space.md }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.text }}>Items ({i.lineItems.length})</Text>
          {i.lineItems.map((l) => (
            <View key={l.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: t.border, paddingTop: space.sm }}>
              <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{l.description}</Text>
              <Muted>{Number(l.quantity)} {l.unit} × {money(l.rateExclGst, fmt)}{Number(l.gstPercent) ? ` + ${Number(l.gstPercent)}% GST` : ""}</Muted>
              <Text style={{ color: t.text, fontSize: 14, textAlign: "right" }}>{money(l.lineTotal, fmt)}</Text>
            </View>
          ))}
        </Card>
      )}

      {file && (
        <Card style={{ gap: space.sm }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.text }}>Original</Text>
          <Image accessibilityLabel="Original invoice" source={{ uri: file.uri, headers: file.headers }} resizeMode="contain" style={{ width: "100%", height: 420, backgroundColor: t.bg, borderRadius: 8 }} />
          <Muted>If the original is a PDF it will not show here. Open it on the website.</Muted>
        </Card>
      )}
    </ScrollView>
  );
}
