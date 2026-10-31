import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, type InvoiceRow } from "@/lib/client";
import { day, money, STATUS_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Badge, Card, ErrorBox, Muted, Screen, Title } from "@/components/ui";
import { PlanBanner } from "@/components/plan-banner";
import { PendingBar } from "@/components/pending-bar";

const FILTERS = [
  { value: "", label: "All" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Paid" },
];

const tone = (s: string) => (s === "PAID" ? "ok" : s === "OVERDUE" ? "danger" : s === "NEEDS_REVIEW" || s === "PARTIALLY_PAID" ? "warn" : "neutral");

export default function Invoices() {
  const t = useTheme();
  const router = useRouter();
  const { client, me } = useSession();
  const fmt = me?.company.brand?.format;

  const [q, setQ] = useState("");
  // The Home screen opens this list already filtered (for example "Overdue").
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState(params.status ?? "");
  useEffect(() => {
    if (params.status !== undefined) setStatus(params.status);
  }, [params.status]);
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (target: number, replace: boolean) => {
      const mine = ++seq.current; // a slow older answer must never overwrite a newer search
      try {
        const r = await client.invoices({ q: q.trim() || undefined, status: status || undefined, page: target, pageSize: 20 });
        if (mine !== seq.current) return;
        setItems((prev) => (replace ? r.items : [...prev, ...r.items]));
        setTotal(r.total);
        setPage(r.page);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(e instanceof ApiError ? e.message : "Could not load invoices.");
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setRefreshing(false);
          setMore(false);
        }
      }
    },
    [client, q, status],
  );

  // Search as the person types, after a short pause.
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => load(1, true), q ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const hasMore = items.length < total;

  return (
    <Screen>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        <Title>Invoices</Title>
        <TextInput
          accessibilityLabel="Search invoices"
          placeholder="Search invoice number or vendor"
          placeholderTextColor={t.muted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 14, fontSize: 15, color: t.text }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}>
          {FILTERS.map((f) => {
            const on = status === f.value;
            return (
              <Pressable
                key={f.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setStatus(f.value)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? t.primary : t.card, borderWidth: 1, borderColor: on ? t.primary : t.border }}
              >
                <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 14, fontWeight: "600" }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {me ? <PlanBanner plan={me.plan} /> : null}
      <PendingBar />

      {error && items.length === 0 ? (
        <ErrorBox message={error} onRetry={() => load(1, true)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => (setRefreshing(true), load(1, true))} tintColor={t.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !more && !loading) {
              setMore(true);
              load(page + 1, false);
            }
          }}
          ListEmptyComponent={loading ? undefined : <View style={{ alignItems: "center", padding: space.xl }}><Muted>{q || status ? "No invoices match." : "No invoices yet. Use Upload to add one."}</Muted></View>}
          ListFooterComponent={more ? <Muted style={{ textAlign: "center", padding: space.md }}>Loading more...</Muted> : undefined}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Invoice ${item.invoiceNumber} from ${item.vendor.name}`} onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: item.id } })}>
              <Card style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: "600", color: t.text }}>{item.vendor.name}</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: t.text }}>{money(item.total, fmt)}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
                  <Muted>{item.invoiceNumber} · {item.project.name}</Muted>
                  <Badge label={STATUS_LABEL[item.status] ?? item.status} tone={tone(item.status)} />
                </View>
                <Muted>{day(item.invoiceDate, fmt)}{item.dueDate && item.status !== "PAID" ? ` · due ${day(item.dueDate, fmt)}` : ""}</Muted>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
