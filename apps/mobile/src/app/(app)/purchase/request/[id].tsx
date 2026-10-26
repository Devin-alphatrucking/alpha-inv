import { useCallback, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type RequestView } from "@/lib/client";
import { REQUEST_NAME, requestTone } from "@/lib/purchase-labels";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Field, Loading, Muted, Screen, SectionTitle, Title } from "@/components/ui";

type Act = "submit" | "withdraw" | "cancel" | "approve" | "reject";

/** One material request: what was asked, and the steps this person may take (send, take back, approve, reject, cancel). */
export default function RequestScreen() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [r, setR] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Act | null>(null);

  const load = useCallback(async () => {
    try {
      setR((await client.purchaseRequest(String(id))).request);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the request.");
    }
  }, [client, id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function act(action: Act, withNote?: string) {
    setBusy(action);
    try {
      await client.actOnRequest(String(id), action, withNote);
      setAsking(null);
      setNote("");
      await load();
    } catch (e) {
      Alert.alert("Could not do that", e instanceof ApiError ? e.message : "Please try again.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const has = (a: string) => r?.actions.includes(a as never) ?? false;
  if (!r && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: r?.number ?? "Request" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {r ? (
          <>
            <View style={{ gap: space.sm }}>
              <Title>{r.number}</Title>
              <View style={{ flexDirection: "row" }}><Badge label={REQUEST_NAME[r.status]} tone={requestTone(r.status)} /></View>
              <Muted>{[r.projectName, `raised by ${r.requestedByName ?? "a former member"}`, r.neededBy ? `needed by ${r.neededBy}` : null].filter(Boolean).join(" · ")}</Muted>
            </View>
            {r.status === "REJECTED" ? <Card><Text style={{ color: t.danger, fontSize: 15 }}>Rejected{r.decidedByName ? ` by ${r.decidedByName}` : ""}: {r.decisionNote}</Text></Card> : null}
            {r.status === "APPROVED" || r.status === "ORDERED" ? <Card><Text style={{ color: t.ok, fontSize: 15 }}>Approved{r.decidedByName ? ` by ${r.decidedByName}` : ""}{r.decisionNote ? `: ${r.decisionNote}` : ""}</Text></Card> : null}

            <Card style={{ gap: space.sm }}>
              <SectionTitle>Items</SectionTitle>
              {r.lines.map((l, i) => (
                <View key={l.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                  <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{i + 1}. {l.description}</Text>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{l.quantity} {l.unit}</Text>
                </View>
              ))}
              {r.note ? <Muted>{r.note}</Muted> : null}
            </Card>

            <View style={{ gap: space.sm }}>
              {has("edit") ? <Button label="Change the request" variant="outline" onPress={() => router.push({ pathname: "/purchase/request-new", params: { id: r.id } })} /> : null}
              {has("submit") ? <Button label="Send for approval" onPress={() => void act("submit")} busy={busy === "submit"} disabled={busy !== null} /> : null}
              {has("withdraw") ? <Button label="Take it back to edit" variant="outline" onPress={() => void act("withdraw")} busy={busy === "withdraw"} disabled={busy !== null} /> : null}
              {has("approve") ? <Button label="Approve" onPress={() => setAsking(asking === "approve" ? null : "approve")} disabled={busy !== null} /> : null}
              {has("reject") ? <Button label="Reject" variant="outline" onPress={() => setAsking(asking === "reject" ? null : "reject")} disabled={busy !== null} /> : null}
              {asking ? (
                <Card style={{ gap: space.sm }}>
                  <Field label={asking === "reject" ? "Why is it rejected?" : "Note (optional)"} multiline value={note} onChangeText={setNote} maxLength={300} style={{ minHeight: 70, textAlignVertical: "top", paddingTop: 12 }} />
                  <Button label={asking === "approve" ? "Confirm approval" : "Confirm rejection"} onPress={() => void act(asking, note)} busy={busy === asking} disabled={busy !== null} />
                </Card>
              ) : null}
              {has("cancel") ? (
                <Button label="Cancel request" variant="danger" disabled={busy !== null} busy={busy === "cancel"} onPress={() => Alert.alert("Cancel this request?", "It cannot be undone.", [{ text: "Keep it", style: "cancel" }, { text: "Cancel request", style: "destructive", onPress: () => void act("cancel") }])} />
              ) : null}
              {has("order") ? <Muted>The purchase officer turns an approved request into an order on the website.</Muted> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
