import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, type PaymentsList } from "@/lib/client";
import { day, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Card, ErrorBox, Loading, Muted } from "@/components/ui";

/** Payments made against confirmed invoices, with the totals the website's Payments page shows. */
export default function Payments() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const fmt = me?.company.brand?.format;
  const [data, setData] = useState<PaymentsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await client.payments());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load payments.");
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading />;

  const tile = (label: string, value: string, color?: string) => (
    <Card style={{ flexGrow: 1, flexBasis: "30%", gap: 4, padding: space.md }}>
      <Text style={{ color: color ?? t.text, fontSize: 17, fontWeight: "700" }} numberOfLines={1} adjustsFontSizeToFit>{money(value, fmt)}</Text>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
    </Card>
  );

  return (
    <FlatList
      data={data.payments}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => (setRefreshing(true), void load())} tintColor={t.primary} />}
      ListHeaderComponent={
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.sm }}>
          {tile("Paid this month", data.totals.paidThisMonth)}
          {tile("Paid so far", data.totals.paid)}
          {tile("Still to pay", data.totals.outstanding, Number(data.totals.outstanding) > 0 ? t.warn : t.ok)}
        </View>
      }
      ListEmptyComponent={<View style={{ alignItems: "center", padding: space.xl }}><Muted>No payments recorded yet. Open an invoice to record one.</Muted></View>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: item.invoice.id } })}>
          <Card style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
              <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: "600" }}>{item.invoice.vendor.name}</Text>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{money(item.amount, fmt)}</Text>
            </View>
            <Muted>{item.invoice.invoiceNumber} · {item.invoice.project.name}</Muted>
            <Muted>{day(item.paidOn, fmt)}{item.mode ? ` · ${item.mode}` : ""}{item.reference ? ` · ${item.reference}` : ""}</Muted>
          </Card>
        </Pressable>
      )}
    />
  );
}
