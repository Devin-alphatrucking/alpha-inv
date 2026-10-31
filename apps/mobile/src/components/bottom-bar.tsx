import { useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter, type Href, type Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { can, roleLabel } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge } from "@/components/ui";

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];
type IconName = React.ComponentProps<typeof Feather>["name"];

type Slot = { route: string; href: Href; label: string; icon: IconName };

/**
 * The bottom bar, built like the website's phone bar: Home, Invoices, a raised Upload button in the middle, one more place, and More.
 * Each person sees only what their role can open (the server still checks every request).
 */
export function BottomBar({ state }: TabBarProps) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, signOut } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const perms = me?.permissions;
  const active = state.routes[state.index]?.name ?? "index";

  const canUpload = can(perms, "invoice:upload");
  const canSite = can(perms, "site:view");
  const canBuy = can(perms, "request:view");

  // The fourth place is the one this person uses most: site work for the crew, purchase for the buyers, otherwise their account.
  const fourth: Slot = canSite
    ? { route: "site", href: "/site", label: "Site", icon: "tool" }
    : canBuy
      ? { route: "purchase", href: "/purchase", label: "Purchase", icon: "shopping-cart" }
      : { route: "account", href: "/account", label: "Account", icon: "user" };

  const moreItems: { route: string; href: Href; label: string; description: string; icon: IconName }[] = [
    ...(canBuy && fourth.route !== "purchase" ? [{ route: "purchase", href: "/purchase" as Href, label: "Purchase", description: "Material requests and deliveries", icon: "shopping-cart" as IconName }] : []),
    ...(canSite && fourth.route !== "site" ? [{ route: "site", href: "/site" as Href, label: "Site work", description: "Daily reports, photos, issues and drawings", icon: "tool" as IconName }] : []),
    ...(can(perms, "payment:view") ? [{ route: "payments", href: "/payments" as Href, label: "Payments", description: "What has been paid and what is still owed", icon: "credit-card" as IconName }] : []),
    ...(can(perms, "vendor:view") ? [{ route: "vendors", href: "/vendors" as Href, label: "Vendors", description: "Suppliers and what you owe each", icon: "briefcase" as IconName }] : []),
    { route: "pending", href: "/pending", label: "Waiting to send", description: "Saved on this phone, not sent yet", icon: "upload-cloud" },
    ...(fourth.route !== "account" ? [{ route: "account", href: "/account" as Href, label: "Account", description: "Your details, company and plan", icon: "user" as IconName }] : []),
  ];
  const moreActive = moreItems.some((m) => m.route === active);

  const initialsOf = (me?.user.name ?? "").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  function item(slot: { route: string; href: Href; label: string; icon: IconName }, isActive: boolean) {
    const color = isActive ? t.primary : t.muted;
    return (
      <Pressable key={slot.route} accessibilityRole="button" accessibilityLabel={slot.label} accessibilityState={{ selected: isActive }} onPress={() => router.navigate(slot.href)} style={styles.slot}>
        <View style={{ alignItems: "center" }}>
          {isActive ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}
          <Feather name={slot.icon} size={21} color={color} />
        </View>
        <Text style={{ color, fontSize: 11, fontWeight: isActive ? "700" : "500" }}>{slot.label}</Text>
      </Pressable>
    );
  }

  function confirmSignOut() {
    setMoreOpen(false);
    Alert.alert("Sign out?", "You will need your email and password to sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void signOut() }]);
  }

  const website = (Constants.expoConfig?.extra?.websiteUrl as string | undefined) ?? "";

  return (
    <>
      <View style={[styles.bar, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={styles.row}>
          {item({ route: "index", href: "/", label: "Home", icon: "grid" }, active === "index")}
          {item({ route: "invoices", href: "/invoices", label: "Invoices", icon: "file-text" }, active === "invoices")}

          {/* The raised Upload button in the middle (an empty space when this person may not upload). */}
          <View style={styles.slot} accessibilityElementsHidden={!canUpload} importantForAccessibility={canUpload ? "auto" : "no-hide-descendants"}>
            {canUpload ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Upload invoice"
                onPress={() => router.navigate("/upload")}
                style={({ pressed }) => [styles.fab, { backgroundColor: t.primary, borderColor: t.card, shadowColor: t.primary, opacity: pressed ? 0.88 : 1 }, active === "upload" && { borderColor: t.border }]}
              >
                <Feather name="plus" size={24} color={t.onPrimary} />
                <Text style={{ color: t.onPrimary, fontSize: 8, fontWeight: "800", letterSpacing: 0.4, marginTop: -1 }}>UPLOAD</Text>
              </Pressable>
            ) : null}
          </View>

          {item(fourth, active === fourth.route)}

          <Pressable accessibilityRole="button" accessibilityLabel="More" accessibilityState={{ expanded: moreOpen, selected: moreActive }} onPress={() => setMoreOpen(true)} style={styles.slot}>
            <View style={{ alignItems: "center" }}>
              {moreActive ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}
              <Feather name="menu" size={21} color={moreActive ? t.primary : t.muted} />
            </View>
            <Text style={{ color: moreActive ? t.primary : t.muted, fontSize: 11, fontWeight: moreActive ? "700" : "500" }}>More</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={() => setMoreOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.grab, { backgroundColor: t.border }]} />
          <ScrollView bounces={false} contentContainerStyle={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: t.text, fontWeight: "700" }}>{initialsOf || "?"}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{me?.user.name}</Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>{me?.user.email}</Text>
              </View>
              {me ? <Badge label={roleLabel(me.user.role)} /> : null}
            </View>

            {moreItems.map((m) => (
              <Pressable
                key={m.route}
                accessibilityRole="button"
                onPress={() => {
                  setMoreOpen(false);
                  router.navigate(m.href);
                }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 12, backgroundColor: pressed ? t.bg : "transparent" })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
                  <Feather name={m.icon} size={18} color={t.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{m.label}</Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{m.description}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={t.muted} />
              </Pressable>
            ))}

            {/* Plans are bought on the website, never in the app. On Android a person can jump there; on iPhone the app only says so (App Store rules about steering to outside payment). */}
            {Platform.OS === "android" && website && me?.user.role === "ADMIN" ? (
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(website)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: 12, backgroundColor: pressed ? t.bg : "transparent" })}>
                <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
                  <Feather name="external-link" size={18} color={t.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>Plan and billing</Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>Managed on the website</Text>
                </View>
              </Pressable>
            ) : null}

            <Pressable accessibilityRole="button" onPress={confirmSignOut} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 48, marginTop: space.sm, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: pressed ? t.bg : "transparent" })}>
              <Feather name="log-out" size={17} color={t.danger} />
              <Text style={{ color: t.danger, fontSize: 15, fontWeight: "600" }}>Sign out</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", height: 62, paddingHorizontal: 8, maxWidth: 480, width: "100%", alignSelf: "center" },
  slot: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, minHeight: 48 },
  dot: { position: "absolute", top: -7, width: 4, height: 4, borderRadius: 2 },
  fab: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", marginTop: -26, borderWidth: 4, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: space.lg, paddingTop: space.sm, maxHeight: "80%" },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: space.md },
});
