import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ApiError, type PhotoView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { space } from "@/lib/theme";
import { Card, ErrorBox, Loading, Screen, SectionTitle } from "@/components/ui";
import { PhotoAdder, PhotoStrip } from "@/components/photos";

/** All photos of a project, newest first, with a way to add more (for example a general site view). */
export default function Photos() {
  const { client, me } = useSession();
  const { projectId, projectName } = useLocalSearchParams<{ projectId: string; projectName?: string }>();
  const [photos, setPhotos] = useState<PhotoView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPhotos((await client.sitePhotos({ projectId: String(projectId) })).photos);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load photos.");
    }
  }, [client, projectId]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (!photos && !error) return <Loading />;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <Stack.Screen options={{ title: projectName ? `Photos · ${projectName}` : "Photos" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 }}>
        {can(me?.permissions, "site:write") ? (
          <Card style={{ gap: space.md }}>
            <SectionTitle>Add photos</SectionTitle>
            <PhotoAdder target={{ projectId: String(projectId) }} onAdded={() => void load()} />
          </Card>
        ) : null}
        {error ? <ErrorBox message={error} onRetry={load} /> : <PhotoStrip photos={photos ?? []} onChanged={load} />}
      </ScrollView>
    </Screen>
  );
}
