import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, type RequestView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { REQUEST_NAME, requestTone } from "@/lib/purchase-labels";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, Chips, ErrorBox, Loading, Muted, Screen, Title } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";

const FILTERS = [
  { id: "", name: "All" },
  { id: "SUBMITTED", name: "To approve" },
  { id: "APPROVED", name: "Approved" },
  { id: "DRAFT", name: "Drafts" },
  { id: "REJECTED", name: "Rejected" },
];

/** Purchase home: material requests (raise, approve) and the way into deliveries. */
export default function Purchase() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const [status, setStatus] = useState("");
  const [requests, setRequests] = useState<RequestView[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const perms = me?.permissions;

  const load = useCallback(async () => {
    try {
      const r = await client.requests({ status });
      setRequests(r.requests);
      setWaiting(r.waitingForApproval);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load requests.");
    } finally {
      setRefreshing(false);
    }
  }, [client, status]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!requests && !error) return <Loading />;
  return (
    <Screen>
      <FlatList
        data={requests ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Title>Purchase</Title>
            {me ? <PlanBanner plan={me.plan} /> : null}
            {can(perms, "request:write") ? <Button label="New material request" onPress={() => router.push("/purchase/request-new")} /> : null}
            {can(perms, "delivery:view") ? <Button label="Deliveries (record what arrived)" variant="outline" onPress={() => router.push("/purchase/deliveries")} /> : null}
            {can(perms, "request:approve") && waiting > 0 ? <Muted>{waiting} {waiting === 1 ? "request is" : "requests are"} waiting for your approval.</Muted> : null}
            <Chips options={FILTERS} value={status} onChange={setStatus} />
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
          </View>
        }
        ListEmptyComponent={error ? undefined : <Muted>No requests here.</Muted>}
        renderItem={({ item: r }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/purchase/request/[id]", params: { id: r.id } })}>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{r.number}</Text>
                <Badge label={REQUEST_NAME[r.status]} tone={requestTone(r.status)} />
              </View>
              <Muted>{r.projectName}</Muted>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 14 }}>{r.lines.map((l) => `${l.description} ${l.quantity} ${l.unit}`).join(", ")}</Text>
              <Muted>{[`by ${r.requestedByName ?? "a former member"}`, r.neededBy ? `needed by ${r.neededBy}` : null].filter(Boolean).join(" · ")}</Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
