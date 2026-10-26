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
    <Stack screenOptions={{ headerTintColor: t.text, headerStyle: { backgroundColor: t.bg }, headerShadowVisible: false, contentStyle: { backgroundColor: t.bg }, headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="invoice/[id]" options={{ title: "Invoice" }} />
      <Stack.Screen name="site/report" options={{ title: "Daily report" }} />
      <Stack.Screen name="site/issues" options={{ title: "Issues" }} />
      <Stack.Screen name="site/issue/[id]" options={{ title: "Issue" }} />
      <Stack.Screen name="site/issue-new" options={{ title: "Raise an issue" }} />
      <Stack.Screen name="site/photos" options={{ title: "Photos" }} />
      <Stack.Screen name="purchase/request-new" options={{ title: "New request" }} />
      <Stack.Screen name="purchase/request/[id]" options={{ title: "Request" }} />
      <Stack.Screen name="purchase/deliveries" options={{ title: "Deliveries" }} />
      <Stack.Screen name="purchase/delivery/[orderId]" options={{ title: "Delivery" }} />
    </Stack>
  );
}
