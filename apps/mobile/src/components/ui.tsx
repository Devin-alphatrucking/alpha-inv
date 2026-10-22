import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "@/lib/theme";

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <SafeAreaView edges={["top", "left", "right"]} style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</SafeAreaView>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "700", color: t.text }}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 14, color: t.muted }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: space.lg }, style]}>{children}</View>;
}

export function Button({ label, onPress, busy, variant = "primary", disabled }: { label: string; onPress: () => void; busy?: boolean; variant?: "primary" | "outline" | "danger"; disabled?: boolean }) {
  const t = useTheme();
  const bg = variant === "primary" ? t.primary : variant === "danger" ? t.danger : "transparent";
  const fg = variant === "outline" ? t.text : variant === "primary" ? t.onPrimary : "#ffffff";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.lg,
        backgroundColor: bg,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: t.border,
        opacity: off ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, inputRef, ...props }: TextInputProps & { label: string; error?: string | null; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>> }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: t.muted }}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        style={{ minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: error ? t.danger : t.border, backgroundColor: t.card, paddingHorizontal: 14, fontSize: 16, color: t.text }}
        {...props}
      />
      {error ? <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const t = useTheme();
  const color = tone === "ok" ? t.ok : tone === "warn" ? t.warn : tone === "danger" ? t.danger : t.muted;
  return (
    <View style={{ borderRadius: 999, borderWidth: 1, borderColor: color, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.md, alignItems: "center", padding: space.xl }}>
      <Text style={{ color: t.danger, textAlign: "center", fontSize: 15 }}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="outline" onPress={onRetry} /> : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
      <ActivityIndicator size="large" color={t.primary} />
    </View>
  );
}
