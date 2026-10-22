import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useTheme } from "@/lib/theme";

// Simple text glyphs keep the app free of an icon library; swap for icons when the design is final.
const glyph = (g: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{g}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border } }}>
      <Tabs.Screen name="index" options={{ title: "Invoices", tabBarIcon: glyph("≡") }} />
      <Tabs.Screen name="upload" options={{ title: "Upload", tabBarIcon: glyph("+") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: glyph("○") }} />
    </Tabs>
  );
}
