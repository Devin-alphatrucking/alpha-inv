import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/lib/session";
import { OfflineProvider } from "@/lib/offline/provider";
import { Loading } from "@/components/ui";

function Gate() {
  // Hold the screens back until we know whether a saved sign-in is still good (no flash of the login screen).
  const { status } = useSession();
  return status === "loading" ? <Loading /> : <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <OfflineProvider>
          <Gate />
        </OfflineProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
