import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Card, Chips, Field, Loading, Muted, Screen, type Option } from "@/components/ui";

type Line = { description: string; unit: string; quantity: string };
const blank = (): Line => ({ description: "", unit: "", quantity: "" });
const UNITS = ["NOS", "BAG", "KG", "TON", "MTR", "SQM", "CUM", "LTR"];

/** Ask for materials for a project (or change a draft, when opened with an id). Save a draft or send it for approval. */
export default function RequestNew() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [projects, setProjects] = useState<Option[]>([]);
  const [projectId, setProjectId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (id) {
          const { request } = await client.purchaseRequest(String(id));
          setProjectId(request.projectId);
          setNeededBy(request.neededBy ?? "");
          setNote(request.note ?? "");
          setLines(request.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity })));
        } else {
          const p = await client.projects();
          setProjects(p.projects.map((x) => ({ id: x.id, name: x.name })));
          if (p.projects.length === 1) setProjectId(p.projects[0].id);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load.");
      } finally {
        setReady(true);
      }
    })();
  }, [client, id]);

  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save(send: boolean) {
    setError(null);
    if (!projectId) return setError("Choose a project.");
    setBusy(send ? "send" : "draft");
    try {
      if (id) {
        await client.changeRequest(String(id), { neededBy, note, lines });
        if (send) await client.actOnRequest(String(id), "submit");
        router.replace({ pathname: "/purchase/request/[id]", params: { id: String(id) } });
      } else {
        const r = await client.raiseRequest({ projectId, neededBy, note, lines, submit: send });
        if (r.warning) Alert.alert("Saved as a draft", r.warning);
        router.replace({ pathname: "/purchase/request/[id]", params: { id: r.id } });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: id ? "Change request" : "New request" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
          {!id ? <Chips label="Project" options={projects} value={projectId} onChange={setProjectId} /> : null}
          {!id && projects.length === 0 ? <Muted>You are not on any active project.</Muted> : null}
          <Field label="Needed by (YYYY-MM-DD, optional)" value={neededBy} onChangeText={setNeededBy} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-11-30" />
          {lines.map((l, i) => (
            <Card key={i} style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>Item {i + 1}</Text>
                {lines.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove item ${i + 1}`} onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Text style={{ color: t.danger, fontSize: 14 }}>Remove</Text></Pressable> : null}
              </View>
              <Field label="What is needed" value={l.description} onChangeText={(v) => setLine(i, "description", v)} placeholder="e.g. Cement OPC 53" maxLength={200} />
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}><Field label="Quantity" keyboardType="decimal-pad" value={l.quantity} onChangeText={(v) => setLine(i, "quantity", v)} /></View>
                <View style={{ flex: 1 }}><Field label="Unit" autoCapitalize="characters" value={l.unit} onChangeText={(v) => setLine(i, "unit", v)} maxLength={12} /></View>
              </View>
              <Chips options={UNITS.map((u) => ({ id: u, name: u }))} value={l.unit.toUpperCase()} onChange={(u) => setLine(i, "unit", u)} />
            </Card>
          ))}
          <Button label="Add an item" variant="outline" onPress={() => setLines((ls) => [...ls, blank()])} disabled={lines.length >= 60} />
          <Field label="Note for the approver (optional)" multiline style={{ minHeight: 80, textAlignVertical: "top", paddingTop: 12 }} value={note} onChangeText={setNote} />
          {error ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
          <View style={{ gap: space.sm }}>
            <Button label="Save draft" variant="outline" onPress={() => void save(false)} busy={busy === "draft"} disabled={busy !== null} />
            <Button label="Send for approval" onPress={() => void save(true)} busy={busy === "send"} disabled={busy !== null} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
