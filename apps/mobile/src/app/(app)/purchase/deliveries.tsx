import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { ApiError, type DeliveryRow } from "@/lib/client";
import { PROGRESS_NAME } from "@/lib/purchase-labels";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Loading, Muted, Screen } from "@/components/ui";

/** Orders sent to suppliers that are waiting for goods. Open one to record what arrived. No prices are shown. */
export default function Deliveries() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await client.deliveries(all)).deliveries);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load deliveries.");
    } finally {
      setRefreshing(false);
    }
  }, [client, all]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!rows && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: "Deliveries" }} />
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.orderId}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Button label={all ? "Only waiting for goods" : "Show fully received too"} variant="outline" onPress={() => setAll(!all)} />
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
          </View>
        }
        ListEmptyComponent={error ? undefined : <Muted>{all ? "No orders have been sent yet." : "Nothing is waiting for delivery."}</Muted>}
        renderItem={({ item: r }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/purchase/delivery/[orderId]", params: { orderId: r.orderId } })}>
            <Card style={{ gap: 6 }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{r.number} · {r.vendorName}</Text>
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                {r.late ? <Badge label="Late" tone="danger" /> : null}
                <Badge label={PROGRESS_NAME[r.progress]} tone={r.progress === "RECEIVED" ? "ok" : r.progress === "PARTLY" ? "warn" : "neutral"} />
              </View>
              <Muted>{[r.projectName, r.deliveryDate ? `due ${r.deliveryDate}` : "no delivery date"].join(" · ")}</Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
