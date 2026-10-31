import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, type VendorRow } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Card, ErrorBox, Loading, Muted } from "@/components/ui";

/** The company's suppliers. Search by name or GSTIN. */
export default function Vendors() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<VendorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await client.vendors(q)).vendors);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load vendors.");
    } finally {
      setRefreshing(false);
    }
  }, [client, q]);

  // Search as the person types, after a short pause.
  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 350 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  if (error && !items) return <ErrorBox message={error} onRetry={load} />;
  if (!items) return <Loading />;

  return (
    <FlatList
      data={items}
      keyExtractor={(v) => v.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => (setRefreshing(true), void load())} tintColor={t.primary} />}
      ListHeaderComponent={
        <TextInput
          accessibilityLabel="Search vendors"
          placeholder="Search name or GSTIN"
          placeholderTextColor={t.muted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 14, fontSize: 15, color: t.text, marginBottom: space.sm }}
        />
      }
      ListEmptyComponent={<View style={{ alignItems: "center", padding: space.xl }}><Muted>{q ? "No vendors match." : "No vendors yet. They are added when you confirm an invoice."}</Muted></View>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/vendors/[id]", params: { id: item.id } })}>
          <Card style={{ gap: 2 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{item.name}</Text>
            <Muted>{item.gstin ? `GSTIN ${item.gstin} · ` : ""}{item.invoiceCount} invoice{item.invoiceCount === 1 ? "" : "s"}</Muted>
          </Card>
        </Pressable>
      )}
    />
  );
}
