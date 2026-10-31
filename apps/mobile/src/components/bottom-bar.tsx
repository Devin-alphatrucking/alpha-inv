import { useState } from "react";
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter, type Href, type Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { can, roleLabel } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
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

  const canPayments = can(perms, "payment:view");
  const canVendors = can(perms, "vendor:view");
  // Same rule as the website's phone bar: people who have somewhere to go besides their own invoices get the full bar with a More menu;
  // everyone else gets Dashboard, My Invoices, Upload and Account.
  const fullBar = canSite || canBuy || canPayments || canVendors;
  // The fourth place, like the website's Payments: payments for those who see them, otherwise the module they use most.
  const fourth: Slot = canPayments
    ? { route: "payments", href: "/payments", label: "Payments", icon: "credit-card" }
    : canSite
      ? { route: "site", href: "/site", label: "Site", icon: "tool" }
      : canBuy
        ? { route: "purchase", href: "/purchase", label: "Purchase", icon: "shopping-cart" }
        : { route: "vendors", href: "/vendors", label: "Vendors", icon: "briefcase" };

  // The More menu lists the same places as the website's, in the same order, then what only the phone has.
  const places: { route: string; href: Href; label: string; description: string; icon: IconName; show: boolean }[] = [
    { route: "purchase", href: "/purchase", label: "Purchase", description: "Material requests & deliveries", icon: "shopping-cart", show: canBuy },
    { route: "site", href: "/site", label: "Site work", description: "Daily reports, photos, issues & drawings", icon: "tool", show: canSite },
    { route: "vendors", href: "/vendors", label: "Vendors", description: "Material suppliers & GSTINs", icon: "briefcase", show: canVendors },
    { route: "payments", href: "/payments", label: "Payments", description: "What has been paid and what is still owed", icon: "credit-card", show: canPayments },
    { route: "pending", href: "/pending", label: "Waiting to send", description: "Saved on this phone, not sent yet", icon: "upload-cloud", show: true },
    { route: "account", href: "/account", label: "Account", description: "Your details, company and plan", icon: "user", show: true },
  ];
  const moreItems = places.filter((m) => m.show && m.route !== (fullBar ? fourth.route : ""));
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

  function accountSlot() {
    const isActive = active === "account";
    return (
      <Pressable key="account" accessibilityRole="button" accessibilityLabel="Account" accessibilityState={{ selected: isActive }} onPress={() => router.navigate("/account")} style={styles.slot}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.soft, alignItems: "center", justifyContent: "center", borderWidth: isActive ? 1.5 : 0, borderColor: t.primary }}>
          <Text style={{ color: t.text, fontSize: 9, fontWeight: "700" }}>{initialsOf || "?"}</Text>
        </View>
        <Text style={{ color: isActive ? t.primary : t.muted, fontSize: 11, fontWeight: isActive ? "700" : "500" }}>Account</Text>
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
          {item({ route: "index", href: "/", label: "Dashboard", icon: "layout" }, active === "index")}
          {item({ route: "invoices", href: "/invoices", label: fullBar ? "Invoices" : "My Invoices", icon: "file-text" }, active === "invoices")}

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

          {fullBar ? item(fourth, active === fourth.route) : accountSlot()}

          {fullBar ? (
            <Pressable accessibilityRole="button" accessibilityLabel="More" accessibilityState={{ expanded: moreOpen, selected: moreActive }} onPress={() => setMoreOpen(true)} style={styles.slot}>
              <View style={{ alignItems: "center" }}>
                {moreActive ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}
                <Feather name="grid" size={21} color={moreActive ? t.primary : t.muted} />
              </View>
              <Text style={{ color: moreActive ? t.primary : t.muted, fontSize: 11, fontWeight: moreActive ? "700" : "500" }}>More</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={() => setMoreOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.grab, { backgroundColor: t.border }]} />
          <ScrollView bounces={false} contentContainerStyle={{ gap: space.sm }}>
            <View style={{ paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: t.border, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text accessibilityRole="header" style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{me?.user.role === "ADMIN" ? "Administration" : "More"}</Text>
                {me ? <Badge label={roleLabel(me.user.role)} /> : null}
              </View>
              <Text style={{ color: t.muted, fontSize: 12 }}>{me?.user.role === "ADMIN" ? "Manage suppliers, payments and site work" : "Everything else you can open"}</Text>
            </View>

            {moreItems.map((m) => (
              <Pressable
                key={m.route}
                accessibilityRole="button"
                onPress={() => {
                  setMoreOpen(false);
                  router.navigate(m.href);
                }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: pressed ? t.soft : "transparent" })}
              >
                <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                  <Feather name={m.icon} size={18} color={t.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>{m.label}</Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{m.description}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={t.muted} />
              </Pressable>
            ))}

            {/* Plans are bought on the website, never in the app. On Android a person can jump there; on iPhone the app only says so (App Store rules about steering to outside payment). */}
            {Platform.OS === "android" && website && me?.user.role === "ADMIN" ? (
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(website)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: pressed ? t.soft : "transparent" })}>
                <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                  <Feather name="external-link" size={18} color={t.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>Plan and billing</Text>
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>Managed on the website</Text>
                </View>
              </Pressable>
            ) : null}

            <View style={{ marginTop: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, padding: space.md, gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: t.text, fontSize: 12, fontWeight: "700" }}>{initialsOf || "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>{me?.user.name}</Text>
                  <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{me?.user.email}</Text>
                </View>
              </View>
              <Pressable accessibilityRole="button" onPress={confirmSignOut} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 44, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: pressed ? t.dangerBg : t.card })}>
                <Feather name="log-out" size={16} color={t.danger} />
                <Text style={{ color: t.danger, fontSize: 15, fontWeight: "500" }}>Sign out</Text>
              </Pressable>
            </View>
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
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: space.lg, paddingTop: space.sm, maxHeight: "80%" },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: space.md },
});
