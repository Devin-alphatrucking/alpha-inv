import { useCallback, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError, type IssueState, type IssueView, type PhotoView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Loading, Muted, Screen, SectionTitle, Title } from "@/components/ui";
import { PhotoAdder, PhotoStrip } from "@/components/photos";
import { SEVERITY_NAME, STATUS_NAME, severityTone } from "@/lib/site-labels";

const VERB: Record<IssueState, string> = { OPEN: "Reopen", IN_PROGRESS: "Start work", FIXED: "Mark fixed", CLOSED: "Close (accept the fix)" };

/** One issue: its details, the steps this person may take, and its photos. */
export default function IssueScreen() {
  const t = useTheme();
  const { client, me } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [issue, setIssue] = useState<IssueView | null>(null);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<IssueState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await client.siteIssue(String(id));
      setIssue(r.issue);
      setPhotos(r.photos);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the issue.");
    }
  }, [client, id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function move(to: IssueState) {
    setBusy(to);
    try {
      await client.setIssueStatus(String(id), to);
      await load();
    } catch (e) {
      Alert.alert("Could not change it", e instanceof ApiError ? e.message : "Please try again.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!issue && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: "Issue" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}>
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {issue ? (
          <>
            <View style={{ gap: space.sm }}>
              <Title>{issue.title}</Title>
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                <Badge label={SEVERITY_NAME[issue.severity]} tone={severityTone(issue.severity)} />
                <Badge label={STATUS_NAME[issue.status]} tone={issue.status === "FIXED" || issue.status === "CLOSED" ? "ok" : "neutral"} />
              </View>
              <Muted>{[issue.projectName, issue.area, issue.dueDate ? `fix by ${issue.dueDate}` : null].filter(Boolean).join(" · ")}</Muted>
              <Muted>Raised by {issue.raisedByName ?? "a former member"} · {issue.assigneeName ? `given to ${issue.assigneeName}` : "not given to anyone"}</Muted>
            </View>
            {issue.description ? <Card><Text style={{ color: t.text, fontSize: 15, lineHeight: 22 }}>{issue.description}</Text></Card> : null}

            {issue.next.length > 0 ? (
              <Card style={{ gap: space.sm }}>
                <SectionTitle>Move it along</SectionTitle>
                {issue.next.map((to) => (
                  <Button key={to} label={issue.status === "FIXED" && to === "OPEN" ? "Not fixed: reopen" : VERB[to]} variant={to === "FIXED" || to === "CLOSED" ? "primary" : "outline"} busy={busy === to} disabled={busy !== null} onPress={() => void move(to)} />
                ))}
              </Card>
            ) : issue.status === "CLOSED" ? <Muted>Closed. A project manager can reopen it.</Muted> : null}

            <Card style={{ gap: space.md }}>
              <SectionTitle>Photos</SectionTitle>
              {can(me?.permissions, "site:write") ? <PhotoAdder target={{ projectId: issue.projectId, issueId: issue.id, area: issue.area ?? undefined }} onAdded={() => void load()} /> : null}
              <PhotoStrip photos={photos} onChanged={load} />
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
