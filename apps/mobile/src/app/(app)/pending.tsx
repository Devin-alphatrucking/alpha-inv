import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { useOffline } from "@/lib/offline/provider";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, Muted, Screen, SectionTitle } from "@/components/ui";

const KIND: Record<string, string> = { issue: "Issue", request: "Material request", delivery: "Delivery" };

/** What was saved on this phone and has not reached the server: send now, try again, or throw away. */
export default function Pending() {
  const t = useTheme();
  const { items, syncing, syncNow, retry, discard } = useOffline();

  function throwAway(id: string) {
    Alert.alert("Throw this away?", "It has not been sent and cannot be brought back.", [
      { text: "Keep it", style: "cancel" },
      { text: "Throw away", style: "destructive", onPress: () => void discard(id) },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Waiting to send" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void syncNow()} />}>
        {items.length === 0 ? <Muted>Nothing is waiting. Everything saved on this phone has been sent.</Muted> : null}
        {items.length > 0 ? <Button label="Send now" onPress={() => void syncNow()} busy={syncing} /> : null}
        {items.map((i) => (
          <Card key={i.id} style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <SectionTitle>{KIND[i.kind] ?? i.kind}</SectionTitle>
              <Badge label={i.state === "failed" ? "Needs a look" : "Waiting"} tone={i.state === "failed" ? "danger" : "warn"} />
            </View>
            <Muted>{i.label}</Muted>
            <Muted>{new Date(i.createdAt).toLocaleString()}{i.photos.length ? ` · ${i.photos.length} ${i.photos.length === 1 ? "photo" : "photos"}` : ""}</Muted>
            {i.error ? <Muted style={{ color: t.danger }}>{i.error}</Muted> : null}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {i.state === "failed" ? <View style={{ flex: 1 }}><Button label="Try again" onPress={() => void retry(i.id)} /></View> : null}
              <View style={{ flex: 1 }}><Button label="Throw away" variant="outline" onPress={() => throwAway(i.id)} /></View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
