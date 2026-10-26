import { useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ApiError, type PhotoTarget, type PhotoView } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Muted } from "@/components/ui";

type Source = { uri: string; headers: Record<string, string> };

/** One site photo, loaded with the person's sign-in (photos are never public links). */
function Picture({ id, size, fit = "cover" }: { id: string; size?: number; fit?: "cover" | "contain" }) {
  const t = useTheme();
  const { client } = useSession();
  const [src, setSrc] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    client.photoSource(id).then((s) => alive && setSrc(s)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [client, id]);
  const box = size ? { width: size, height: size } : { width: "100%" as const, height: "100%" as const };
  if (failed || !src) return <View style={[box, { backgroundColor: t.border, alignItems: "center", justifyContent: "center" }]}><Text style={{ color: t.muted, fontSize: 12 }}>{failed ? "No picture" : "…"}</Text></View>;
  return <Image source={src} style={box} resizeMode={fit} onError={() => setFailed(true)} accessibilityLabel="Site photo" />;
}

/** The photos of a report, issue or delivery. Tap one to see it full screen; hold it to delete (when allowed). */
export function PhotoStrip({ photos, onChanged }: { photos: PhotoView[]; onChanged?: () => void }) {
  const t = useTheme();
  const { client } = useSession();
  const [open, setOpen] = useState<PhotoView | null>(null);

  function remove(p: PhotoView) {
    Alert.alert("Delete this photo?", "It cannot be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await client.deleteSitePhoto(p.id);
            setOpen(null);
            onChanged?.();
          } catch (e) {
            Alert.alert("Could not delete", e instanceof ApiError ? e.message : "Please try again.");
          }
        },
      },
    ]);
  }

  if (photos.length === 0) return <Muted>No photos yet.</Muted>;
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {photos.map((p) => (
          <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={p.caption || p.area || "Site photo"} onPress={() => setOpen(p)} onLongPress={() => p.canDelete && remove(p)} style={{ borderRadius: 10, overflow: "hidden" }}>
            <Picture id={p.id} size={96} />
          </Pressable>
        ))}
      </View>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" }}>
          {open ? <View style={{ flex: 1, margin: space.md }}><Picture id={open.id} fit="contain" /></View> : null}
          <View style={{ padding: space.lg, gap: space.sm }}>
            {open ? <Text style={{ color: "#ffffff", fontSize: 14 }}>{[open.caption, open.area, open.takenOn, open.uploaderName ? `by ${open.uploaderName}` : null].filter(Boolean).join(" · ")}</Text> : null}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}><Button label="Close" variant="outline" onPress={() => setOpen(null)} /></View>
              {open?.canDelete ? <View style={{ flex: 1 }}><Button label="Delete" variant="danger" onPress={() => open && remove(open)} /></View> : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Take a photo or pick from the gallery (up to 10) and add it to a project, report, issue or delivery. */
/** `beforeAdd` runs after the photos are chosen and may return the report to attach them to (for example after saving a draft first); returning nothing cancels. */
export function PhotoAdder({ target, onAdded, disabled, beforeAdd }: { target: PhotoTarget; onAdded: () => void; disabled?: boolean; beforeAdd?: () => Promise<string | null | undefined> }) {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);

  async function send(assets: ImagePicker.ImagePickerAsset[]) {
    if (assets.length === 0) return;
    setBusy(true);
    try {
      let aim = target;
      if (beforeAdd) {
        const reportId = await beforeAdd();
        if (!reportId) return; // could not save the draft: the screen shows why
        aim = { ...target, reportId };
      }
      const r = await client.uploadSitePhotos(
        assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `site-${Date.now()}-${i}.jpg`, type: a.mimeType ?? "image/jpeg" })),
        aim,
      );
      if (r.skipped.length) Alert.alert("Some photos were not added", r.skipped.join("\n"));
      onAdded();
    } catch (e) {
      Alert.alert("Photos not added", e instanceof ApiError ? e.message : "Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function camera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access is off", "Allow the camera in your phone's settings, or choose photos from your gallery.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled) await send(r.assets);
  }

  async function gallery() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 10 });
    if (!r.canceled) await send(r.assets);
  }

  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ flex: 1 }}><Button label="Take photo" onPress={camera} busy={busy} disabled={disabled} /></View>
      <View style={{ flex: 1 }}><Button label="From gallery" variant="outline" onPress={gallery} busy={busy} disabled={disabled} /></View>
    </View>
  );
}
