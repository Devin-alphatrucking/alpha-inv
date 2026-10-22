import { Redirect, Stack } from "expo-router";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function AppLayout() {
  const { status } = useSession();
  const t = useTheme();
  if (status === "signedOut") return <Redirect href="/login" />;
  return (
    <Stack screenOptions={{ headerTintColor: t.text, headerStyle: { backgroundColor: t.bg }, headerShadowVisible: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="invoice/[id]" options={{ title: "Invoice", headerBackTitle: "Back" }} />
    </Stack>
  );
}
