import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError, type DeliveryView, type PhotoView } from "@/lib/client";
import { PROGRESS_NAME } from "@/lib/purchase-labels";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Field, Loading, Muted, Screen, SectionTitle, Title } from "@/components/ui";
import { PhotoAdder, PhotoStrip } from "@/components/photos";

type Entry = { quantity: string; rejected: string; remark: string };

/** Record what arrived against one order: per item how much was good and how much was refused, then photos of the challan and goods. */
export default function DeliveryScreen() {
  const t = useTheme();
  const { client, me } = useSession();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [d, setD] = useState<DeliveryView | null>(null);
  const [today, setToday] = useState("");
  const [photos, setPhotos] = useState<Record<string, PhotoView[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [challanNo, setChallanNo] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const canWrite = can(me?.permissions, "delivery:write");

  const load = useCallback(async () => {
    try {
      const r = await client.delivery(String(orderId));
      setD(r.delivery);
      setToday(r.today);
      const found = await Promise.all(r.delivery.receipts.map((x) => client.sitePhotos({ receiptId: x.id }).then((p) => [x.id, p.photos] as const).catch(() => [x.id, [] as PhotoView[]] as const)));
      setPhotos(Object.fromEntries(found));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the delivery.");
    }
  }, [client, orderId]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const get = (id: string): Entry => entries[id] ?? { quantity: "", rejected: "", remark: "" };
  const set = (id: string, k: keyof Entry, v: string) => setEntries((s) => ({ ...s, [id]: { ...get(id), [k]: v } }));

  async function record() {
    if (!d) return;
    setFormError(null);
    setBusy(true);
    try {
      await client.recordDelivery(d.orderId, { receivedOn: today, challanNo, note, lines: d.lines.map((l) => ({ orderLineId: l.id, ...get(l.id) })) });
      setEntries({});
      setChallanNo("");
      setNote("");
      Alert.alert("Delivery recorded", "Now add photos of the challan and the goods to it below.");
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not record the delivery. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function remove(receiptId: string) {
    Alert.alert("Remove this delivery?", "The quantities will no longer count as received.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await client.deleteDelivery(receiptId);
            await load();
          } catch (e) {
            Alert.alert("Could not remove it", e instanceof ApiError ? e.message : "Please try again.");
          }
        },
      },
    ]);
  }

  if (!d && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: d?.number ?? "Delivery" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
          {error ? <ErrorBox message={error} onRetry={load} /> : null}
          {d ? (
            <>
              <View style={{ gap: space.sm }}>
                <Title>{d.number}</Title>
                <View style={{ flexDirection: "row" }}><Badge label={PROGRESS_NAME[d.progress]} tone={d.progress === "RECEIVED" ? "ok" : d.progress === "PARTLY" ? "warn" : "neutral"} /></View>
                <Muted>{[d.vendorName, d.projectName, d.deliveryDate ? `due ${d.deliveryDate}` : null].filter(Boolean).join(" · ")}</Muted>
                {!d.canRecord && (d.status === "DRAFT" || d.status === "CANCELLED" || d.status === "CLOSED") ? <Text style={{ color: t.danger, fontSize: 14 }}>This order is {d.status === "CANCELLED" ? "cancelled" : d.status === "CLOSED" ? "closed" : "not sent to the supplier yet"}, so deliveries cannot be recorded.</Text> : null}
              </View>

              <Card style={{ gap: space.sm }}>
                <SectionTitle>Ordered and received</SectionTitle>
                {d.lines.map((l) => (
                  <View key={l.id} style={{ gap: 2 }}>
                    <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{l.description}</Text>
                    <Muted>Ordered {l.ordered} {l.unit} · received {l.received} · refused {l.rejected} · {l.progress === "OVER" ? "more than ordered" : `to come ${l.remaining}`}</Muted>
                  </View>
                ))}
              </Card>

              {d.canRecord ? (
                <Card style={{ gap: space.md }}>
                  <SectionTitle>Record a delivery (today, {today})</SectionTitle>
                  <Field label="Challan or delivery note number" value={challanNo} onChangeText={setChallanNo} maxLength={60} />
                  {d.lines.map((l) => (
                    <View key={l.id} style={{ gap: space.sm }}>
                      <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{l.description} ({l.unit})</Text>
                      <View style={{ flexDirection: "row", gap: space.sm }}>
                        <View style={{ flex: 1 }}><Field label="Arrived OK" keyboardType="decimal-pad" value={get(l.id).quantity} onChangeText={(v) => set(l.id, "quantity", v)} /></View>
                        <View style={{ flex: 1 }}><Field label="Refused" keyboardType="decimal-pad" value={get(l.id).rejected} onChangeText={(v) => set(l.id, "rejected", v)} /></View>
                      </View>
                      <Field label="Remark" value={get(l.id).remark} onChangeText={(v) => set(l.id, "remark", v)} maxLength={200} placeholder="optional" />
                    </View>
                  ))}
                  <Field label="Note" multiline value={note} onChangeText={setNote} style={{ minHeight: 70, textAlignVertical: "top", paddingTop: 12 }} />
                  {formError ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{formError}</Text> : null}
                  <Button label="Record delivery" onPress={record} busy={busy} />
                </Card>
              ) : null}

              <SectionTitle>Deliveries recorded ({d.receipts.length})</SectionTitle>
              {d.receipts.length === 0 ? <Muted>Nothing has arrived yet.</Muted> : null}
              {d.receipts.map((r) => (
                <Card key={r.id} style={{ gap: space.sm }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{r.receivedOn}{r.challanNo ? ` · challan ${r.challanNo}` : ""}</Text>
                  <Muted>recorded by {r.receivedByName ?? "a former member"}</Muted>
                  {r.lines.map((l, i) => (
                    <Text key={i} style={{ color: t.text, fontSize: 14 }}>{l.description}: {l.quantity} {l.unit}{Number(l.rejected) > 0 ? ` · ${l.rejected} refused` : ""}{l.remark ? ` · ${l.remark}` : ""}</Text>
                  ))}
                  {r.note ? <Muted>{r.note}</Muted> : null}
                  {canWrite ? <PhotoAdder target={{ projectId: d.projectId, receiptId: r.id }} onAdded={() => void load()} /> : null}
                  {(photos[r.id]?.length ?? 0) > 0 ? <PhotoStrip photos={photos[r.id]} onChanged={load} /> : null}
                  {r.canDelete ? <Button label="Remove this delivery" variant="outline" onPress={() => remove(r.id)} /> : null}
                </Card>
              ))}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
