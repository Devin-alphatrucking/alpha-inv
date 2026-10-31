import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type VendorDetail } from "@/lib/client";
import { day, money, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Card, ErrorBox, Loading, Muted } from "@/components/ui";

/** One supplier: what has been billed, paid and is still owed, and their invoices. */
export default function VendorScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, me } = useSession();
  const fmt = me?.company.brand?.format;
  const [data, setData] = useState<VendorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await client.vendor(String(id)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this vendor.");
    }
  }, [client, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading />;

  const tile = (label: string, value: string, color?: string) => (
    <Card style={{ flexGrow: 1, flexBasis: "30%", gap: 4, padding: space.md }}>
      <Text style={{ color: color ?? t.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1} adjustsFontSizeToFit>{money(value, fmt)}</Text>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 22, fontWeight: "700" }}>{data.vendor.name}</Text>
        {data.vendor.gstin ? <Muted>GSTIN {data.vendor.gstin}</Muted> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {tile("Billed", data.totals.billed)}
        {tile("Paid", data.totals.paid)}
        {tile("Owed", data.totals.owed, Number(data.totals.owed) > 0 ? t.warn : t.ok)}
      </View>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }}>Invoices</Text>
      {data.invoices.length === 0 ? <Muted>No invoices yet.</Muted> : null}
      {data.invoices.map((i) => (
        <Pressable key={i.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: i.id } })}>
          <Card style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
              <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{i.invoiceNumber}</Text>
              <Text style={{ color: t.text, fontSize: 15, fontWeight: "700" }}>{money(i.total, fmt)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <Muted>{i.project.name} · {day(i.invoiceDate, fmt)}</Muted>
              <Badge label={STATUS_LABEL[i.status] ?? i.status} tone={i.status === "PAID" ? "ok" : i.status === "OVERDUE" ? "danger" : "warn"} />
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
