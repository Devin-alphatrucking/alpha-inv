import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError, type PhotoView, type ReportView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, Chips, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from "@/components/ui";
import { PhotoAdder, PhotoStrip } from "@/components/photos";

const WEATHER = ["Clear", "Cloudy", "Light rain", "Heavy rain", "Hot", "Windy", "Fog"].map((w) => ({ id: w, name: w }));

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Form = { weather: string; labourCount: string; workDone: string; machinery: string; materialsUsed: string; problems: string; safetyNote: string };
const EMPTY: Form = { weather: "", labourCount: "", workDone: "", machinery: "", materialsUsed: "", problems: "", safetyNote: "" };
const fromReport = (r: ReportView): Form => ({ weather: r.weather ?? "", labourCount: r.labourCount?.toString() ?? "", workDone: r.workDone, machinery: r.machinery ?? "", materialsUsed: r.materialsUsed ?? "", problems: r.problems ?? "", safetyNote: r.safetyNote ?? "" });

/** One day's report for one project: write it, add photos, submit it. */
export default function ReportScreen() {
  const t = useTheme();
  const { client, me } = useSession();
  const params = useLocalSearchParams<{ projectId: string; projectName?: string; date: string }>();
  const projectId = String(params.projectId);
  const today = String(params.date);
  const [date, setDate] = useState(today);
  const [report, setReport] = useState<ReportView | null>(null);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "submit" | "reopen" | null>(null);
  const canWrite = can(me?.permissions, "site:write");

  const load = useCallback(async () => {
    try {
      const r = await client.siteReport(projectId, date);
      setReport(r.report);
      setPhotos(r.photos);
      setForm(r.report ? fromReport(r.report) : EMPTY);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [client, projectId, date]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  // Photos taken in another screen (or removed) show up when coming back.
  useFocusEffect(useCallback(() => { if (report) void client.siteReport(projectId, date).then((r) => setPhotos(r.photos)).catch(() => undefined); }, [client, projectId, date, report]));

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const editable = report ? report.canEdit : canWrite;

  async function save(): Promise<ReportView | null> {
    setFieldError(null);
    setBusy("save");
    try {
      const r = await client.saveSiteReport({ projectId, reportDate: date, ...form });
      setReport(r.report);
      return r.report;
    } catch (e) {
      setFieldError(e instanceof ApiError ? e.message : "Could not save. Please try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const saved = await save();
    if (!saved) return;
    setBusy("submit");
    try {
      await client.submitSiteReport(saved.id);
      Alert.alert("Report submitted", "It is now locked. A project manager can reopen it if something must change.");
      await load();
    } catch (e) {
      setFieldError(e instanceof ApiError ? e.message : "Could not submit.");
    } finally {
      setBusy(null);
    }
  }

  async function reopen() {
    if (!report) return;
    setBusy("reopen");
    try {
      await client.reopenSiteReport(report.id);
      await load();
    } catch (e) {
      setFieldError(e instanceof ApiError ? e.message : "Could not reopen.");
    } finally {
      setBusy(null);
    }
  }

  // A photo needs a report to belong to: save the draft first when there is none yet.
  async function ensureReport() {
    if (report) return report;
    return save();
  }

  if (loading) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: params.projectName ? String(params.projectName) : "Daily report" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setDate(shift(date, -1))} style={{ padding: space.md }}><Text style={{ color: t.text, fontSize: 22 }}>‹</Text></Pressable>
            <View style={{ alignItems: "center", gap: 4 }}>
              <SectionTitle>{date}</SectionTitle>
              <Badge label={report ? (report.status === "SUBMITTED" ? "Submitted" : "Draft") : "Not written"} tone={report?.status === "SUBMITTED" ? "ok" : report ? "warn" : "neutral"} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Next day" disabled={date >= today} onPress={() => setDate(shift(date, 1))} style={{ padding: space.md, opacity: date >= today ? 0.3 : 1 }}><Text style={{ color: t.text, fontSize: 22 }}>›</Text></Pressable>
          </View>

          {loadError ? <ErrorBox message={loadError} onRetry={load} /> : null}
          {!report && !canWrite ? <Muted>No report was written for this day.</Muted> : (
            <>
              <Chips label="Weather" options={WEATHER} value={form.weather} onChange={set("weather")} />
              <Field label="Workers on site" keyboardType="number-pad" value={form.labourCount} onChangeText={set("labourCount")} editable={editable} />
              <Field label="Work done today" multiline numberOfLines={5} style={{ minHeight: 110, textAlignVertical: "top", paddingTop: 12 }} value={form.workDone} onChangeText={set("workDone")} editable={editable} placeholder="What was done, where, and how far it got." />
              <Field label="Machinery used" multiline value={form.machinery} onChangeText={set("machinery")} editable={editable} />
              <Field label="Materials used or received" multiline value={form.materialsUsed} onChangeText={set("materialsUsed")} editable={editable} />
              <Field label="Problems or delays" multiline value={form.problems} onChangeText={set("problems")} editable={editable} />
              <Field label="Safety note" multiline value={form.safetyNote} onChangeText={set("safetyNote")} editable={editable} />
              {fieldError ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{fieldError}</Text> : null}
              {editable ? (
                <View style={{ gap: space.sm }}>
                  <Button label={report ? "Save changes" : "Save draft"} variant="outline" onPress={() => void save()} busy={busy === "save"} />
                  <Button label="Save and submit" onPress={submit} busy={busy === "submit"} />
                </View>
              ) : report?.canReopen ? (
                <Button label="Reopen for changes" variant="outline" onPress={reopen} busy={busy === "reopen"} />
              ) : report?.status === "SUBMITTED" ? <Muted>Submitted. A project manager can reopen it.</Muted> : null}

              <Card style={{ gap: space.md }}>
                <SectionTitle>Photos for this day</SectionTitle>
                {editable ? (
                  <PhotoAdder
                    target={{ projectId, reportId: report?.id }}
                    onAdded={() => void load()}
                    beforeAdd={async () => (await ensureReport())?.id}
                  />
                ) : null}
                <PhotoStrip photos={photos} onChanged={load} />
              </Card>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
