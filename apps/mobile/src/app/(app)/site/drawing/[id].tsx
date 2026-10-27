import { useCallback, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError, type DocumentView } from "@/lib/client";
import { CATEGORY_NAME, humanSize } from "@/lib/doc-labels";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, ErrorBox, Loading, Muted, Screen, SectionTitle, Title } from "@/components/ui";

/** One drawing: the current revision to build from, and the older ones kept for the record. Files open in the phone's browser or viewer. */
export default function DrawingScreen() {
  const t = useTheme();
  const { client } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDoc((await client.document(String(id))).document);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the drawing.");
    }
  }, [client, id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function open(revisionId: string) {
    setBusy(revisionId);
    try {
      // The browser cannot send the app's sign-in, so the server gives a five-minute address for this one file.
      const { url } = await client.documentLink(revisionId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Could not open the file", e instanceof ApiError ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!doc && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: doc?.number ?? "Drawing" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}>
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {doc ? (
          <>
            <View style={{ gap: space.sm }}>
              <Title>{doc.title}</Title>
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                <Badge label={CATEGORY_NAME[doc.category] ?? doc.category} />
                {doc.current ? <Badge label={`Current: rev ${doc.current.revision}`} tone="ok" /> : null}
              </View>
              <Muted>{[doc.number, doc.projectName].filter(Boolean).join(" · ")}</Muted>
              {doc.description ? <Text style={{ color: t.text, fontSize: 15 }}>{doc.description}</Text> : null}
            </View>
            {doc.current ? (
              <Card style={{ gap: space.sm }}>
                <SectionTitle>Build from this</SectionTitle>
                <Muted>Revision {doc.current.revision} · {doc.current.formatLabel}, {humanSize(doc.current.sizeBytes)} · issued {doc.current.issuedOn}</Muted>
                {doc.current.note ? <Text style={{ color: t.text, fontSize: 14 }}>{doc.current.note}</Text> : null}
                <Button label={doc.current.opensInPage ? "Open the drawing" : "Download the file"} onPress={() => void open(doc.current!.id)} busy={busy === doc.current.id} />
              </Card>
            ) : null}
            <SectionTitle>History ({doc.revisionCount})</SectionTitle>
            {doc.revisions.map((r) => (
              <Card key={r.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>Revision {r.revision}</Text>
                  {r.isCurrent ? <Badge label="Current" tone="ok" /> : <Badge label="Older" />}
                </View>
                <Muted>issued {r.issuedOn}{r.uploadedByName ? ` by ${r.uploadedByName}` : ""} · {r.formatLabel}, {humanSize(r.sizeBytes)}</Muted>
                {r.note ? <Text style={{ color: t.text, fontSize: 14 }}>{r.note}</Text> : null}
                {!r.isCurrent ? <Button label="Open this older revision" variant="outline" onPress={() => void open(r.id)} busy={busy === r.id} /> : null}
              </Card>
            ))}
            <Muted>Drawings are added and revised by the office on the website.</Muted>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
