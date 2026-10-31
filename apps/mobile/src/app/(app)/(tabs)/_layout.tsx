import { Tabs } from "expo-router";
import { BottomBar } from "@/components/bottom-bar";

// The bar itself (Home, Invoices, raised Upload, one more place, More) is built in components/bottom-bar.tsx, like the website's phone bar.
// Every screen stays registered here so the bar and the More sheet can open it; what each person sees depends on their role.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices" }} />
      <Tabs.Screen name="upload" options={{ title: "Upload" }} />
      <Tabs.Screen name="site" options={{ title: "Site" }} />
      <Tabs.Screen name="purchase" options={{ title: "Purchase" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
