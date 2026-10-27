import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Chips, Field, Screen, type Option } from "@/components/ui";

const SEVERITIES: Option[] = [{ id: "LOW", name: "Low" }, { id: "MEDIUM", name: "Medium" }, { id: "HIGH", name: "High" }];

/** Raise an issue (snag) on a project. Photos are added from the issue's own screen afterwards. */
export default function NewIssue() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
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
      const r = await client.raiseIssue({ projectId: String(projectId), title, description, area, severity: severity as "LOW" | "MEDIUM" | "HIGH", dueDate, assigneeId });
      router.replace({ pathname: "/site/issue/[id]", params: { id: r.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not raise the issue. Please try again.");
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
          {people.length > 1 ? <Chips label="Given to" options={people} value={assigneeId} onChange={setAssigneeId} /> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
          <Button label="Raise issue" onPress={send} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
