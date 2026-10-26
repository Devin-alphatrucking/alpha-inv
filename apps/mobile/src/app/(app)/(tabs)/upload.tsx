import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Card, Chips, ErrorBox, Muted, Screen, Title, type Option } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";

type Picked = { uri: string; name: string; type: string };
export default function Upload() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const [projects, setProjects] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    setLoadError(null);
    try {
      const [p, c] = await Promise.all([client.projects(), client.categories()]);
      setProjects(p.projects);
      setCategories(c.categories);
      setProjectId((cur) => cur || (p.projects.length === 1 ? p.projects[0].id : ""));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load your projects.");
    }
  }, [client]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access is off", "Allow the camera in your phone's settings to photograph invoices, or choose a photo or PDF instead.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.fileName ?? `invoice-${Date.now()}.jpg`, type: a.mimeType ?? "image/jpeg" });
      setError(null);
    }
  }

  async function choosePhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.fileName ?? `invoice-${Date.now()}.jpg`, type: a.mimeType ?? "image/jpeg" });
      setError(null);
    }
  }

  async function choosePdf() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/pdf" });
      setError(null);
    }
  }

  async function send() {
    if (!file) return setError("Choose a photo or PDF first.");
    if (!projectId) return setError("Choose a project.");
    if (!categoryId) return setError("Choose a category.");
    setBusy(true);
    setError(null);
    try {
      const r = await client.upload(file, projectId, categoryId);
      setFile(null);
      await client.me().catch(() => undefined);
      const open = () => router.push({ pathname: "/invoice/[id]", params: { id: r.invoiceId } });
      if (r.duplicateWarning) {
        Alert.alert("Possible duplicate", `This looks like invoice ${r.originalInvoiceNumber ?? "you already added"}. It was added for review.`, [{ text: "Open", onPress: open }, { text: "OK" }]);
      } else {
        Alert.alert("Invoice added", "It is being read now. Check it under Invoices.", [{ text: "Open", onPress: open }, { text: "OK" }]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const blocked = me && me.plan.message && ["trial_expired", "past_due", "canceled", "none"].includes(me.plan.state);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Title>Upload invoice</Title>
        {me ? <PlanBanner plan={me.plan} /> : null}
        {loadError ? (
          <ErrorBox message={loadError} onRetry={loadOptions} />
        ) : (
          <>
            <Card style={{ gap: space.md }}>
              <View style={{ gap: space.sm }}>
                <Button label="Take a photo" onPress={takePhoto} disabled={!!blocked} />
                <Button label="Choose a photo" variant="outline" onPress={choosePhoto} disabled={!!blocked} />
                <Button label="Choose a PDF" variant="outline" onPress={choosePdf} disabled={!!blocked} />
              </View>
              {file ? <Text numberOfLines={1} style={{ color: t.ok, fontSize: 14 }}>Ready: {file.name}</Text> : <Muted>Photograph the whole page in good light, or pick a file. Each page counts toward your monthly AI page limit.</Muted>}
            </Card>
            <Chips label="Project" options={projects} value={projectId} onChange={setProjectId} />
            <Chips label="Category" options={categories} value={categoryId} onChange={setCategoryId} />
            {error ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
            <Button label="Upload and read invoice" onPress={send} busy={busy} disabled={!!blocked} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
