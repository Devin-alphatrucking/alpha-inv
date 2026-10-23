import { Redirect, Stack } from "expo-router";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { LOCKED_STATES, LockedScreen } from "@/components/locked-screen";

export default function AppLayout() {
  const { status, me } = useSession();
  const t = useTheme();
  if (status === "signedOut") return <Redirect href="/login" />;
  // Trial over, plan ended or unpaid: the server hides company data, so the app shows the locked message instead of empty or failing screens.
  if (me && LOCKED_STATES.has(me.plan.state)) return <LockedScreen />;
  return (
    <Stack screenOptions={{ headerTintColor: t.text, headerStyle: { backgroundColor: t.bg }, headerShadowVisible: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="invoice/[id]" options={{ title: "Invoice", headerBackTitle: "Back" }} />
    </Stack>
  );
}
