import { ScrollView, Text, View } from "react-native";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Card, Muted, Screen } from "@/components/ui";

const MESSAGE: Record<string, string> = {
  trial_expired: "Your free trial has ended. Your data is safe and kept for you, but it stays hidden until a plan is active.",
  past_due: "Your last payment did not go through and the grace period has ended. Your data is safe, but it stays hidden until the payment is settled.",
  canceled: "Your subscription has ended. Your data is safe and kept for you, but it stays hidden until a plan is active again.",
  none: "This company does not have an active plan yet.",
};

/** States in which the server hides company data (the app shows this instead of the invoice screens). Buying happens on the website (store rules). */
export const LOCKED_STATES = new Set(["trial_expired", "past_due", "canceled", "none"]);

export function LockedScreen() {
  const t = useTheme();
  const { me, reload, signOut } = useSession();
  const state = me?.plan.state ?? "none";
  const admin = me?.user.role === "ADMIN";
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <Text style={{ fontSize: 40 }}>🔒</Text>
          <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: "700", color: t.text, textAlign: "center" }}>Your data is locked</Text>
          <Muted style={{ textAlign: "center" }}>{MESSAGE[state] ?? MESSAGE.none}</Muted>
        </View>
        <Card style={{ gap: space.sm }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{admin ? "Choose a plan on the website" : "Ask your administrator"}</Text>
          <Muted>
            {admin
              ? "Sign in on the website, open Plan & billing, and choose a plan. Everything comes back as soon as it is active."
              : "Only an administrator of your company can choose a plan. Everything is kept and comes back as soon as a plan is active."}
          </Muted>
        </Card>
        <Button label="I have paid: check again" onPress={() => void reload().catch(() => undefined)} />
        <Button label="Sign out" variant="outline" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}
