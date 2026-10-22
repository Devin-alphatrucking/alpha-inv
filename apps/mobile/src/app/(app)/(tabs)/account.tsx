import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Button, Card, Muted, Screen, Title } from "@/components/ui";

const STATE_LABEL: Record<string, string> = {
  trial: "Free trial",
  active: "Active",
  past_due_grace: "Payment overdue",
  past_due: "Payment overdue",
  canceling: "Ends soon",
  canceled: "Ended",
  trial_expired: "Trial ended",
  none: "No plan",
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const t = useTheme();
  const pct = limit <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / limit) * 100));
  const color = used > limit ? t.danger : pct >= 80 ? t.warn : t.ok;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
        <Muted>{used} of {limit}</Muted>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: limit, now: used }} style={{ height: 8, borderRadius: 4, backgroundColor: t.border, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: color }} />
      </View>
    </View>
  );
}

export default function Account() {
  const t = useTheme();
  const { me, signOut, switchCompany } = useSession();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const brand = me.company.brand;
  const current = me.companies.find((c) => c.id === me.company.id);

  async function change(id: string) {
    if (id === me!.company.id) return;
    setBusy(true);
    try {
      await switchCompany(id);
    } catch (e) {
      Alert.alert("Could not switch company", e instanceof ApiError ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", "You will need your email and password to sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void signOut() }]);
  }

  const support = brand?.supportEmail ? `mailto:${brand.supportEmail}?subject=${encodeURIComponent("Support request from the app")}` : brand?.supportUrl;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Title>Account</Title>

        <Card style={{ gap: 4 }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{me.user.name}</Text>
          <Muted>{me.user.email}</Muted>
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
            <Badge label={me.user.role === "ADMIN" ? "Administrator" : "Staff"} />
            {current ? <Badge label={current.name} /> : null}
          </View>
        </Card>

        {me.companies.length > 1 && (
          <Card style={{ gap: space.sm }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>Switch company</Text>
            {me.companies.map((c) => {
              const on = c.id === me.company.id;
              return (
                <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: on, busy }} disabled={busy} onPress={() => change(c.id)} style={{ paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.border }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: on ? "700" : "400" }}>{c.name}</Text>
                  <Muted>{on ? "Current" : c.role === "ADMIN" ? "Administrator" : "Staff"}</Muted>
                </Pressable>
              );
            })}
          </Card>
        )}

        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{me.plan.name ?? "Plan"}</Text>
            <Badge label={STATE_LABEL[me.plan.state] ?? me.plan.state} tone={me.plan.state === "active" ? "ok" : me.plan.state === "trial" || me.plan.state === "canceling" ? "warn" : "danger"} />
          </View>
          <Meter label="Active projects" used={me.plan.usage.projects} limit={me.plan.limits.projects} />
          <Meter label="People (with invitations)" used={me.plan.usage.users + me.plan.usage.pendingInvites} limit={me.plan.limits.users} />
          <Muted>To add project plans or change billing, sign in on the website.</Muted>
        </Card>

        {support ? <Button label="Contact support" variant="outline" onPress={() => void Linking.openURL(support)} /> : null}
        <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
        <Muted style={{ textAlign: "center" }}>Version {Constants.expoConfig?.version ?? "1.0.0"}</Muted>
      </ScrollView>
    </Screen>
  );
}
