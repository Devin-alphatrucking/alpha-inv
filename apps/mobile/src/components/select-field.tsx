import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useTheme } from "@/lib/theme";
import type { Option } from "@/components/ui";

/**
 * The website's select box: a field showing the chosen value (or a grey prompt) with a chevron; tapping it opens the list in a bottom sheet.
 * `label` may carry a red star for required fields (`required`), and `hint` is the small grey line under the field.
 */
export function SelectField({ label, required, hint, placeholder, options, value, onChange, disabled }: { label: string; required?: boolean; hint?: React.ReactNode; placeholder: string; options: Option[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.id === value);
  const off = disabled || options.length === 0;

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "500", color: t.text }}>
        {label}
        {required ? <Text style={{ color: t.danger }}> *</Text> : null}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen?.name ?? placeholder}`}
        disabled={off}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 14, opacity: off ? 0.5 : pressed ? 0.85 : 1 })}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: chosen ? t.text : t.muted }}>{chosen?.name ?? placeholder}</Text>
        <Feather name="chevron-down" size={18} color={t.muted} />
      </Pressable>
      {hint ? <Text style={{ fontSize: 12, lineHeight: 18, color: t.muted }}>{hint}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close list" style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.4)" }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: t.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, 16), maxHeight: "70%" }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.md }} />
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 16, fontWeight: "600", marginBottom: space.sm }}>{label}</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => {
              const on = item.id === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed || on ? t.soft : "transparent" })}
                >
                  <Text style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: on ? "600" : "400" }}>{item.name}</Text>
                  {on ? <Feather name="check" size={18} color={t.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}
