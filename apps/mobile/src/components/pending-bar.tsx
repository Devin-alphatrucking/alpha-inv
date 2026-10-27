import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { useOffline } from "@/lib/offline/provider";
import { space, useTheme } from "@/lib/theme";

/** Shown above a home screen while something saved on this phone has not reached the server yet. */
export function PendingBar() {
  const t = useTheme();
  const router = useRouter();
  const { items, syncing } = useOffline();
  if (items.length === 0) return null;
  const stuck = items.filter((i) => i.state === "failed").length;
  const text = syncing ? "Sending what was saved on this phone…" : stuck > 0 ? `${stuck} saved on this phone ${stuck === 1 ? "needs" : "need"} a look` : `${items.length} saved on this phone, waiting for a connection`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Open the list.`} onPress={() => router.push("/pending")} style={{ backgroundColor: stuck > 0 ? t.danger : t.warn, borderRadius: 12, paddingVertical: space.md, paddingHorizontal: space.lg }}>
      <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "600" }}>{text}</Text>
      <Text style={{ color: "#ffffff", fontSize: 13, marginTop: 2 }}>Tap to see them or send now</Text>
    </Pressable>
  );
}
