import { Alert, Image, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { LocalFile } from "@/lib/offline/queue";
import { space, useTheme } from "@/lib/theme";
import { Button, Muted } from "@/components/ui";

const MAX = 10;

/** Photos chosen before the record exists (they are sent with it, or kept on the phone until there is a connection). */
export function LocalPhotos({ value, onChange }: { value: LocalFile[]; onChange: (files: LocalFile[]) => void }) {
  const t = useTheme();

  function add(assets: ImagePicker.ImagePickerAsset[]) {
    const next = [...value, ...assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `site-${Date.now()}-${i}.jpg`, type: a.mimeType ?? "image/jpeg" }))];
    onChange(next.slice(0, MAX));
    if (next.length > MAX) Alert.alert("Up to 10 photos", "The first 10 were kept.");
  }

  async function camera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access is off", "Allow the camera in your phone's settings, or choose photos from your gallery.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled) add(r.assets);
  }

  async function gallery() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: Math.max(1, MAX - value.length) });
    if (!r.canceled) add(r.assets);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: t.muted }}>Photos</Text>
      {value.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {value.map((f, i) => (
            <Pressable key={f.uri} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => onChange(value.filter((_, j) => j !== i))} style={{ borderRadius: 10, overflow: "hidden" }}>
              <Image source={{ uri: f.uri }} style={{ width: 72, height: 72 }} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Muted>None added. They are kept on this phone until they can be sent.</Muted>
      )}
      {value.length > 0 ? <Muted>Tap a photo to take it off.</Muted> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}><Button label="Take photo" variant="outline" onPress={camera} disabled={value.length >= MAX} /></View>
        <View style={{ flex: 1 }}><Button label="From gallery" variant="outline" onPress={gallery} disabled={value.length >= MAX} /></View>
      </View>
    </View>
  );
}
