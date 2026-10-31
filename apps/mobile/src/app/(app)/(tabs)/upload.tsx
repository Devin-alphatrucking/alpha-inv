import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Field, Screen, type Option } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";
import { SelectField } from "@/components/select-field";

type Picked = { uri: string; name: string; type: string; size?: number; isImage: boolean };
type Stage = "idle" | "uploading" | "extracting" | "done";

const MAX_BYTES = 20 * 1024 * 1024;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload an invoice, laid out like the website's page: heading and one line of help, pending reviews (for staff), then the "New invoice"
 * card with Project, Invoice category, "Or create a new category", the drop area (Browse files / Use camera) and the Extract button.
 */
export default function Upload() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  // Same rule as the website: only administrators and accountants see every project; everyone else is "staff" with their own projects.
  const isStaff = me ? me.user.role !== "ADMIN" && me.user.role !== "ACCOUNTANT" : true;
  const [projects, setProjects] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = stage !== "idle";

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
    void loadOptions();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [loadOptions]);

  // "Pending reviews": invoices still being read or waiting to be checked (the server only counts what this person may see).
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([client.invoices({ status: "NEEDS_REVIEW", pageSize: 1 }), client.invoices({ status: "PROCESSING", pageSize: 1 })])
        .then(([a, b]) => live && setPending(a.total + b.total))
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [client]),
  );

  function accept(next: Picked) {
    if (next.size !== undefined && next.size > MAX_BYTES) {
      setError("File must be 20MB or smaller.");
      return;
    }
    setFile(next);
    setError(null);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access is off", "Allow the camera in your phone's settings to photograph invoices, or browse for a photo or PDF instead.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      accept({ uri: a.uri, name: a.fileName ?? `invoice-${Date.now()}.jpg`, type: a.mimeType ?? "image/jpeg", size: a.fileSize, isImage: true });
    }
  }

  async function browse() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      const type = a.mimeType ?? "application/pdf";
      if (!/^(application\/pdf|image\/(jpeg|png))$/.test(type)) return setError("Only PDF, JPG, or PNG files are supported.");
      accept({ uri: a.uri, name: a.name, type, size: a.size, isImage: type.startsWith("image/") });
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return setError("Enter a category name");
    setCreating(true);
    setError(null);
    try {
      const r = await client.createCategory(name);
      setCategories((cur) => (cur.some((c) => c.id === r.category.id) ? cur : [...cur, r.category].sort((a, b) => a.name.localeCompare(b.name))));
      setCategoryId(r.category.id);
      setNewCategory("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add the category. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function send() {
    if (!file) return setError("Select or snap an invoice first.");
    if (!categoryId) return setError("Select a category for this invoice first.");
    if (!projectId) return setError("Select the project this invoice belongs to.");
    setError(null);
    setStage("uploading");
    // The phone sends the file and the server reads it in one request, so the second step is shown after a short moment of waiting.
    timer.current = setTimeout(() => setStage((s) => (s === "uploading" ? "extracting" : s)), 2000);
    try {
      const r = await client.upload({ uri: file.uri, name: file.name, type: file.type }, projectId, categoryId);
      if (timer.current) clearTimeout(timer.current);
      setStage("done");
      await client.me().catch(() => undefined);
      const open = () => router.push({ pathname: "/invoice/[id]", params: { id: r.invoiceId } });
      setFile(null);
      setStage("idle");
      if (r.duplicateWarning) {
        Alert.alert("Possible duplicate", `This looks like invoice ${r.originalInvoiceNumber ?? "you already added"}. It was added for review.`, [{ text: "Open", onPress: open }, { text: "OK" }]);
      } else {
        Alert.alert("Extraction complete", "Your invoice was read. Open it to verify and save.", [{ text: "Open review", onPress: open }, { text: "OK" }]);
      }
    } catch (e) {
      if (timer.current) clearTimeout(timer.current);
      setStage("idle");
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    }
  }

  const blocked = Boolean(me && me.plan.message && ["trial_expired", "past_due", "canceled", "none"].includes(me.plan.state));
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const hasCategories = categories.length > 0;
  const canExtract = Boolean(file && projectId && categoryId && !busy && !blocked);
  const buttonLabel = busy ? (stage === "uploading" ? "Uploading file…" : stage === "extracting" ? "Extracting invoice with AI…" : "Opening review…") : !file ? "Select or snap an invoice to extract" : !projectId ? "Select a project above to continue" : !categoryId ? "Select category above to continue" : "Extract invoice data";

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: "600", letterSpacing: -0.4 }}>{isStaff ? "Upload an invoice" : "Upload invoice"}</Text>
          <Text style={{ color: t.muted, fontSize: 14, lineHeight: 21 }}>
            {isStaff ? "Snap or drop a purchase invoice. We’ll extract the fields — then you verify and save." : "Upload a scanned or photographed invoice. We extract the fields, then you verify and save."}
          </Text>
        </View>

        {me ? <PlanBanner plan={me.plan} /> : null}

        {pending > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => router.navigate("/invoices")}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 16 }}>
              <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                <Feather name="clipboard" size={18} color={t.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>Pending reviews</Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>Finish verifying extracted invoices</Text>
              </View>
              <Badge label={String(pending)} />
            </Card>
          </Pressable>
        ) : null}

        <Card style={{ gap: space.lg, borderRadius: 16, padding: space.lg }}>
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>New invoice</Text>
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 18 }}>PDF, JPG, or PNG — max 20MB</Text>
          </View>

          {loadError ? (
            <ErrorBox message={loadError} onRetry={loadOptions} />
          ) : (
            <>
              <SelectField label="Project" required placeholder="Select project…" options={projects} value={projectId} onChange={setProjectId} disabled={busy} hint="The invoice, review, payments, and reports will stay with this project." />
              <SelectField
                label="Invoice category"
                required
                placeholder="Select category…"
                options={categories}
                value={categoryId}
                onChange={setCategoryId}
                disabled={busy}
                hint={
                  !hasCategories ? (
                    <Text style={{ color: t.warn }}>No categories yet — create one below to continue.</Text>
                  ) : selectedCategory ? (
                    <>Selected: <Text style={{ color: t.text, fontWeight: "500" }}>{selectedCategory.name}</Text>. You can change this later on review.</>
                  ) : (
                    "Pick the material type for this invoice."
                  )
                }
              />

              <View style={{ gap: 6 }}>
                <Text style={{ color: t.muted, fontSize: 12, fontWeight: "500" }}>Or create a new category</Text>
                <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Field label="New category name" value={newCategory} onChangeText={setNewCategory} editable={!busy && !creating} placeholder="e.g. Tile Adhesive" returnKeyType="done" onSubmitEditing={addCategory} />
                  </View>
                  <View style={{ marginTop: 26 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add category"
                      disabled={busy || creating || !newCategory.trim()}
                      onPress={addCategory}
                      style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, opacity: busy || creating || !newCategory.trim() ? 0.5 : pressed ? 0.85 : 1 })}
                    >
                      {creating ? <ActivityIndicator size="small" color={t.text} /> : <Feather name="plus" size={16} color={t.text} />}
                      <Text style={{ color: t.text, fontSize: 15, fontWeight: "500" }}>Add</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* The drop area */}
              <View
                style={{
                  minHeight: 190,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.md,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderStyle: "dashed",
                  borderColor: stage === "done" ? "rgba(16,185,129,0.4)" : error && !file ? "rgba(231,0,11,0.35)" : t.border,
                  backgroundColor: stage === "done" ? "rgba(236,253,245,0.6)" : "transparent",
                  paddingHorizontal: space.lg,
                  paddingVertical: space.xl,
                }}
              >
                {busy ? (
                  <View style={{ alignItems: "center", gap: space.md, width: "100%" }}>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                      {stage === "done" ? <Feather name="check-circle" size={34} color={t.ok} /> : <ActivityIndicator size="large" color={t.text} />}
                    </View>
                    <Text style={{ color: t.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.2 }}>{stage === "uploading" ? "Uploading file…" : stage === "extracting" ? "Reading invoice with AI…" : "Ready — opening review"}</Text>
                    <Text style={{ color: t.muted, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      {stage === "uploading" ? "Saving your document securely." : stage === "extracting" ? "Extracting vendor, totals, and line items. This can take a few seconds." : "Taking you to the verify screen."}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 6, width: "100%", maxWidth: 260 }}>
                      {(["uploading", "extracting", "done"] as const).map((s, i) => {
                        const order = { uploading: 0, extracting: 1, done: 2 } as const;
                        return <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: order[stage as keyof typeof order] >= i ? t.primary : t.soft }} />;
                      })}
                    </View>
                  </View>
                ) : file ? (
                  <View style={{ alignItems: "center", gap: space.md, width: "100%" }}>
                    {file.isImage ? (
                      <Image accessibilityLabel="Invoice preview" source={{ uri: file.uri }} resizeMode="contain" style={{ width: "100%", height: 150, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }} />
                    ) : (
                      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                        <Feather name="file-text" size={32} color={t.muted} />
                      </View>
                    )}
                    <View style={{ alignItems: "center", gap: 2, maxWidth: "100%" }}>
                      <Text numberOfLines={1} style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{file.name}</Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{file.size !== undefined ? `${formatBytes(file.size)} · ` : ""}Ready to extract</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setFile(null);
                        setError(null);
                      }}
                      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? t.soft : "transparent" })}
                    >
                      <Feather name="x" size={14} color={t.text} />
                      <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>Choose a different file</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                      <Feather name="upload-cloud" size={30} color={t.muted} />
                    </View>
                    <View style={{ alignItems: "center", gap: 4 }}>
                      <Text style={{ color: t.text, fontSize: 17, fontWeight: "600", letterSpacing: -0.2, textAlign: "center" }}>Add your invoice</Text>
                      <Text style={{ color: t.muted, fontSize: 13, textAlign: "center", lineHeight: 19 }}>Supports PDF, JPG, PNG up to 20MB.</Text>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center", paddingTop: space.xs }}>
                      <Pressable accessibilityRole="button" disabled={blocked} onPress={browse} style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: t.soft, opacity: blocked ? 0.5 : pressed ? 0.85 : 1 })}>
                        <Feather name="file-text" size={15} color={t.text} />
                        <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>Browse files</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" disabled={blocked} onPress={takePhoto} style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, opacity: blocked ? 0.5 : pressed ? 0.85 : 1 })}>
                        <Feather name="camera" size={15} color={t.text} />
                        <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>Use camera</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>

              {error ? (
                <View accessibilityRole="alert" style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: "rgba(231,0,11,0.3)", backgroundColor: t.dangerBg, paddingHorizontal: space.lg, paddingVertical: space.md }}>
                  <Text style={{ color: t.danger, fontSize: 14, lineHeight: 20 }}>{error}</Text>
                </View>
              ) : null}

              <Button label={buttonLabel} onPress={send} busy={busy} disabled={!canExtract && !busy} />
            </>
          )}
        </Card>

        {isStaff ? (
          <View style={{ alignItems: "center" }}>
            <Pressable accessibilityRole="button" onPress={() => router.navigate("/invoices")} style={({ pressed }) => ({ minHeight: 40, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? t.soft : "transparent" })}>
              <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>View my invoices</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
