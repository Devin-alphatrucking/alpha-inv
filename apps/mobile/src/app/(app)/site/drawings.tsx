import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type DocumentView } from "@/lib/client";
import { CATEGORY_CHOICES, CATEGORY_NAME, humanSize } from "@/lib/doc-labels";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Card, Chips, ErrorBox, Field, Loading, Muted, Screen } from "@/components/ui";

/** Drawings and documents of a project: the current revision of each. Open one to see its history and open the file. */
export default function Drawings() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const { projectId, projectName } = useLocalSearchParams<{ projectId: string; projectName?: string }>();
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDocs((await client.documents({ projectId: String(projectId), category, q: q.trim() })).documents);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load drawings.");
    } finally {
      setRefreshing(false);
    }
  }, [client, projectId, category, q]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!docs && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: projectName ? `Drawings · ${projectName}` : "Drawings" }} />
      <FlatList
        data={docs ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Field label="Search" value={q} onChangeText={setQ} placeholder="Title or drawing number" returnKeyType="search" onSubmitEditing={() => void load()} />
            <Chips options={CATEGORY_CHOICES} value={category} onChange={setCategory} />
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
          </View>
        }
        ListEmptyComponent={error ? undefined : <Muted>No drawings here.</Muted>}
        renderItem={({ item: d }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/site/drawing/[id]", params: { id: d.id } })}>
            <Card style={{ gap: 6 }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{d.number ? `${d.number} · ` : ""}{d.title}</Text>
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                <Badge label={CATEGORY_NAME[d.category] ?? d.category} />
                {d.current ? <Badge label={`Rev ${d.current.revision}`} tone="ok" /> : null}
              </View>
              <Muted>{[d.current ? `${d.current.formatLabel}, ${humanSize(d.current.sizeBytes)}` : null, d.current ? `issued ${d.current.issuedOn}` : null, d.revisionCount > 1 ? `${d.revisionCount} revisions` : null].filter(Boolean).join(" · ")}</Muted>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
