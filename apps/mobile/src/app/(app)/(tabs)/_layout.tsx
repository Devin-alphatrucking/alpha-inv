import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useSession } from "@/lib/session";
import { can } from "@/lib/roles";
import { useTheme } from "@/lib/theme";

// Simple text glyphs keep the app free of an icon library; swap for icons when the design is final.
const glyph = (g: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{g}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  const { me } = useSession();
  // Each person sees only the tabs their role can use (the list comes from the server; the server still checks every request).
  const perms = me?.permissions;
  const show = (permission: string) => (me ? can(perms, permission) : permission === "invoice:view");
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border } }}>
      <Tabs.Screen name="index" options={{ title: "Invoices", tabBarIcon: glyph("≡") }} />
      <Tabs.Screen name="upload" options={{ title: "Upload", tabBarIcon: glyph("+"), href: show("invoice:upload") ? undefined : null }} />
      <Tabs.Screen name="site" options={{ title: "Site", tabBarIcon: glyph("⌂"), href: show("site:view") ? undefined : null }} />
      <Tabs.Screen name="purchase" options={{ title: "Purchase", tabBarIcon: glyph("▤"), href: show("request:view") ? undefined : null }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: glyph("○") }} />
    </Tabs>
  );
}
