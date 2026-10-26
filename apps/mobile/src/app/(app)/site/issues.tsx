import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type IssueCounts, type IssueView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, Chips, ErrorBox, Loading, Muted, Screen } from "@/components/ui";
import { SEVERITY_NAME, STATUS_NAME, severityTone } from "@/lib/site-labels";

const FILTERS = [
  { id: "", name: "Not closed" },
  { id: "OPEN", name: "Open" },
  { id: "IN_PROGRESS", name: "In progress" },
  { id: "FIXED", name: "Fixed" },
  { id: "CLOSED", name: "Closed" },
];
/** Issues (snags) of a project, most serious first. */
export default function Issues() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const { projectId, projectName } = useLocalSearchParams<{ projectId: string; projectName?: string }>();
  const [status, setStatus] = useState("");
  const [issues, setIssues] = useState<IssueView[] | null>(null);
  const [counts, setCounts] = useState<IssueCounts | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await client.siteIssues({ projectId: String(projectId), status });
      setIssues(r.issues);
      setCounts(r.counts);
      setToday(r.today);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load issues.");
    } finally {
      setRefreshing(false);
    }
  }, [client, projectId, status]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!issues && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: projectName ? `Issues · ${projectName}` : "Issues" }} />
      <FlatList
        data={issues ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            {can(me?.permissions, "site:write") ? <Button label="Raise an issue" onPress={() => router.push({ pathname: "/site/issue-new", params: { projectId: String(projectId) } })} /> : null}
            <Chips options={FILTERS} value={status} onChange={setStatus} />
            {counts ? <Muted>{counts.open} open · {counts.inProgress} in progress · {counts.fixed} fixed{counts.overdue ? ` · ${counts.overdue} overdue` : ""}</Muted> : null}
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
          </View>
        }
        ListEmptyComponent={error ? undefined : <Muted>No issues here.</Muted>}
        renderItem={({ item: i }) => {
          const late = !!i.dueDate && i.dueDate < today && (i.status === "OPEN" || i.status === "IN_PROGRESS");
          return (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/site/issue/[id]", params: { id: i.id } })}>
              <Card style={{ gap: 6 }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{i.title}</Text>
                <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                  <Badge label={SEVERITY_NAME[i.severity]} tone={severityTone(i.severity)} />
                  <Badge label={late ? "Overdue" : STATUS_NAME[i.status]} tone={late ? "danger" : i.status === "FIXED" || i.status === "CLOSED" ? "ok" : "neutral"} />
                </View>
                <Muted>{[i.area, i.assigneeName ? `given to ${i.assigneeName}` : "not given to anyone", i.dueDate ? `due ${i.dueDate}` : null].filter(Boolean).join(" · ")}</Muted>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
