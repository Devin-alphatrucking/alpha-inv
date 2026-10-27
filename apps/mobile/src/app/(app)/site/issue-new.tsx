import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { useOffline } from "@/lib/offline/provider";
import type { LocalFile } from "@/lib/offline/queue";
import { LocalPhotos } from "@/components/local-photos";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Chips, Field, Screen, type Option } from "@/components/ui";

const SEVERITIES: Option[] = [{ id: "LOW", name: "Low" }, { id: "MEDIUM", name: "Medium" }, { id: "HIGH", name: "High" }];

/** Raise an issue (snag) on a project, with photos. Works without a connection: it is kept on the phone and sent later. */
export default function NewIssue() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const offline = useOffline();
  const [photos, setPhotos] = useState<LocalFile[]>([]);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [people, setPeople] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.sitePeople(String(projectId)).then((r) => setPeople([{ id: "", name: "Nobody yet" }, ...r.people])).catch(() => undefined);
  }, [client, projectId]);

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const o = await offline.save({ kind: "issue", label: title.trim() || "Issue", projectId: String(projectId), body: { projectId: String(projectId), title, description, area, severity, dueDate, assigneeId }, photos, photoArea: area });
      if (o.kind === "sent") router.replace({ pathname: "/site/issue/[id]", params: { id: o.serverId } });
      else if (o.kind === "rejected") setError(o.message);
      else {
        Alert.alert("Saved on this phone", o.kind === "offline" ? "There is no connection right now. The issue will be sent as soon as there is." : "Please sign in again. The issue will be sent after you do.");
        router.back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise the issue. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: "Raise an issue" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
          <Field label="What is wrong?" value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Honeycombing in column C4" />
          <Field label="Details" multiline style={{ minHeight: 90, textAlignVertical: "top", paddingTop: 12 }} value={description} onChangeText={setDescription} />
          <Field label="Where on site" value={area} onChangeText={setArea} placeholder="Tower A, level 3" />
          <Chips label="How serious" options={SEVERITIES} value={severity} onChange={setSeverity} />
          <Field label="Fix by (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} keyboardType="numbers-and-punctuation" placeholder="2026-11-30" maxLength={10} />
          <LocalPhotos value={photos} onChange={setPhotos} />
          {people.length > 1 ? <Chips label="Given to" options={people} value={assigneeId} onChange={setAssigneeId} /> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
          <Button label="Raise issue" onPress={send} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
