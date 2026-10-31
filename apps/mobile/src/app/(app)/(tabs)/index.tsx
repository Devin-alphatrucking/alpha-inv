import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { ApiError, type SiteOverview } from "@/lib/client";
import { can } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Card, ErrorBox, Muted, Screen, SectionTitle } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";
import { PendingBar } from "@/components/pending-bar";

type Counts = {
  needsReview: number | null;
  unpaid: number | null;
  overdue: number | null;
  site: SiteOverview | null;
  waitingApproval: number | null;
  approvedToOrder: number | null;
};

const EMPTY: Counts = { needsReview: null, unpaid: null, overdue: null, site: null, waitingApproval: null, approvedToOrder: null };

function Tile({ label, value, tone, onPress }: { label: string; value: number | null; tone?: "danger" | "warn"; onPress: () => void }) {
  const t = useTheme();
  const color = value && tone === "danger" ? t.danger : value && tone === "warn" ? t.warn : t.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? "loading"}`} onPress={onPress} style={({ pressed }) => ({ flexGrow: 1, flexBasis: "30%", opacity: pressed ? 0.8 : 1 })}>
      <Card style={{ gap: 4, padding: space.md }}>
        <Text style={{ color, fontSize: 26, fontWeight: "700" }}>{value ?? "-"}</Text>
        <Muted style={{ fontSize: 12 }}>{label}</Muted>
      </Card>
    </Pressable>
  );
}

function Action({ icon, label, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexGrow: 1, flexBasis: "46%", opacity: pressed ? 0.8 : 1 })}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
          <Feather name={icon} size={18} color={t.primary} />
        </View>
        <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      </Card>
    </Pressable>
  );
}

/** The first screen, like the website's dashboard: what needs attention today, and the things people do most. */
export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const perms = me?.permissions;
  const [c, setC] = useState<Counts>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const canInvoices = can(perms, "invoice:view");
  const canSite = can(perms, "site:view");
  const canBuy = can(perms, "request:view");

  const load = useCallback(async () => {
    try {
      const count = (status: string) => client.invoices({ status, pageSize: 1 }).then((r) => r.total);
      const [needsReview, unpaid, overdue, site, requests] = await Promise.all([
        canInvoices ? count("NEEDS_REVIEW") : null,
        canInvoices ? count("UNPAID") : null,
        canInvoices ? count("OVERDUE") : null,
        canSite ? client.siteOverview() : null,
        canBuy ? client.requests({ status: "" }) : null,
      ]);
      setC({ needsReview, unpaid, overdue, site, waitingApproval: requests?.waitingForApproval ?? null, approvedToOrder: requests?.approvedToOrder ?? null });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your summary.");
    } finally {
      setRefreshing(false);
    }
  }, [client, canInvoices, canSite, canBuy]);

  // Refresh every time the person comes back to Home, so the numbers are never stale.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!me) return null;
  const first = me.user.name.trim().split(/\s+/)[0] || me.user.name;
  const companyName = me.companies.find((x) => x.id === me.company.id)?.name ?? me.company.brand?.name ?? "";
  const go = (href: Href) => router.navigate(href);
  const siteTotals = c.site ? { open: c.site.projects.reduce((n, p) => n + p.openIssues, 0), late: c.site.projects.reduce((n, p) => n + p.overdueIssues, 0), missing: c.site.projects.filter((p) => !p.todayReport).length } : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xl }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => (setRefreshing(true), void load())} tintColor={t.primary} />}>
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "700", color: t.text }}>Hello, {first}</Text>
          <Muted>{companyName}</Muted>
        </View>
        <PlanBanner plan={me.plan} />
        <PendingBar />
        {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

        {canInvoices ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>Invoices</SectionTitle>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Tile label="Needs review" value={c.needsReview} tone="warn" onPress={() => go({ pathname: "/invoices", params: { status: "NEEDS_REVIEW" } })} />
              <Tile label="Unpaid" value={c.unpaid} onPress={() => go({ pathname: "/invoices", params: { status: "UNPAID" } })} />
              <Tile label="Overdue" value={c.overdue} tone="danger" onPress={() => go({ pathname: "/invoices", params: { status: "OVERDUE" } })} />
            </View>
          </View>
        ) : null}

        {canSite ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>Site</SectionTitle>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Tile label="Open issues" value={siteTotals?.open ?? null} onPress={() => router.push("/site/issues")} />
              <Tile label="Overdue issues" value={siteTotals?.late ?? null} tone="danger" onPress={() => router.push("/site/issues")} />
              <Tile label="No report today" value={siteTotals?.missing ?? null} tone="warn" onPress={() => go("/site")} />
            </View>
          </View>
        ) : null}

        {canBuy ? (
          <View style={{ gap: space.sm }}>
            <SectionTitle>Purchase</SectionTitle>
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Tile label="Waiting for approval" value={c.waitingApproval} tone="warn" onPress={() => go("/purchase")} />
              <Tile label="Approved, to order" value={c.approvedToOrder} onPress={() => go("/purchase")} />
            </View>
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <SectionTitle>Quick actions</SectionTitle>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {can(perms, "invoice:upload") ? <Action icon="camera" label="Upload an invoice" onPress={() => go("/upload")} /> : null}
            {can(perms, "site:write") ? <Action icon="clipboard" label="Daily report" onPress={() => router.push("/site/report")} /> : null}
            {can(perms, "site:write") ? <Action icon="alert-triangle" label="Raise an issue" onPress={() => router.push("/site/issue-new")} /> : null}
            {can(perms, "request:write") ? <Action icon="shopping-cart" label="Material request" onPress={() => router.push("/purchase/request-new")} /> : null}
            {can(perms, "delivery:view") ? <Action icon="truck" label="Record a delivery" onPress={() => router.push("/purchase/deliveries")} /> : null}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
