import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, type SiteOverview } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Loading, Muted, Screen, SectionTitle, Title } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";
import { PendingBar } from "@/components/pending-bar";

/** Site work home: for each project, today's report and the open issues. */
export default function Site() {
  const router = useRouter();
  const { client, me } = useSession();
  const [data, setData] = useState<SiteOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canWrite = can(me?.permissions, "site:write");

  const load = useCallback(async () => {
    try {
      setData(await client.siteOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load site work.");
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  // Reload whenever the tab comes back into view (after saving a report or raising an issue).
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!data && !error) return <Loading />;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <Title>Site work</Title>
        {me ? <PlanBanner plan={me.plan} /> : null}
        <PendingBar />
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {data?.projects.length === 0 ? <Muted>You are not on any active project yet. Ask an administrator to assign you.</Muted> : null}
        {data?.projects.map((p) => (
          <Card key={p.id} style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <SectionTitle>{p.name}</SectionTitle>
              <Badge label={p.todayReport === "SUBMITTED" ? "Report submitted" : p.todayReport === "DRAFT" ? "Report draft" : "No report today"} tone={p.todayReport === "SUBMITTED" ? "ok" : p.todayReport === "DRAFT" ? "warn" : "neutral"} />
            </View>
            <Muted>{p.openIssues} open {p.openIssues === 1 ? "issue" : "issues"}{p.overdueIssues > 0 ? ` · ${p.overdueIssues} overdue` : ""}</Muted>
            <Button label={p.todayReport ? "Open today's report" : canWrite ? "Write today's report" : "No report yet"} disabled={!p.todayReport && !canWrite} onPress={() => router.push({ pathname: "/site/report", params: { projectId: p.id, projectName: p.name, date: data.today } })} />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}><Button label="Drawings" variant="outline" onPress={() => router.push({ pathname: "/site/drawings", params: { projectId: p.id, projectName: p.name } })} /></View>
              <View style={{ flex: 1 }}><Button label="Issues" variant="outline" onPress={() => router.push({ pathname: "/site/issues", params: { projectId: p.id, projectName: p.name } })} /></View>
              <View style={{ flex: 1 }}><Button label="Photos" variant="outline" onPress={() => router.push({ pathname: "/site/photos", params: { projectId: p.id, projectName: p.name } })} /></View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
