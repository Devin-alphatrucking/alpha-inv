import { ActivityIndicator, Image, Pressable, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius, space, useTheme } from "@/lib/theme";
import { API_URL } from "@/lib/session";

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <SafeAreaView edges={["top", "left", "right"]} style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</SafeAreaView>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: "600", letterSpacing: -0.4, color: t.text }}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 14, color: t.muted }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: radius.lg, borderWidth: 1, borderColor: t.border, padding: space.lg }, style]}>{children}</View>;
}

export function Button({ label, onPress, busy, variant = "primary", disabled }: { label: string; onPress: () => void; busy?: boolean; variant?: "primary" | "outline" | "danger"; disabled?: boolean }) {
  const t = useTheme();
  // Like the website: solid dark primary, white outline button, and a soft red tint for destructive actions.
  const bg = variant === "primary" ? t.primary : variant === "danger" ? t.dangerBg : t.card;
  const fg = variant === "outline" ? t.text : variant === "primary" ? t.onPrimary : t.danger;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.lg,
        backgroundColor: bg,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: t.border,
        opacity: off ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: "500" }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, inputRef, style, ...props }: TextInputProps & { label: string; error?: string | null; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>> }) {
  const t = useTheme();
  const multiline = !!props.multiline;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: "500", color: t.text }}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        selectionColor={t.primary}
        {...props}
        // The same look for every field (48pt high, 16pt text so nothing zooms or clips). A screen can add to this look, never lose it.
        style={[
          { minHeight: multiline ? 96 : 48, borderRadius: radius.lg, borderWidth: 1, borderColor: error ? t.danger : t.border, backgroundColor: t.card, paddingHorizontal: 14, fontSize: 16, color: t.text },
          multiline ? { textAlignVertical: "top", paddingTop: 12, paddingBottom: 12 } : { paddingVertical: 10 },
          props.editable === false ? { opacity: 0.6 } : null,
          style,
        ]}
      />
      {error ? <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const t = useTheme();
  const color = tone === "ok" ? t.ok : tone === "warn" ? t.warn : tone === "danger" ? t.danger : t.text;
  const bg = tone === "ok" ? t.okBg : tone === "warn" ? t.warnBg : tone === "danger" ? t.dangerBg : t.soft;
  return (
    <View style={{ borderRadius: radius.pill, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: 12, fontWeight: "500" }}>{label}</Text>
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

export type Option = { id: string; name: string };

/** A row of choices (project, severity, weather...). Tap one to choose it. */
export function Chips({ label, options, value, onChange }: { label?: string; options: Option[]; value: string; onChange: (id: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Text style={{ fontSize: 14, fontWeight: "500", color: t.text }}>{label}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable key={o.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.id)} style={{ paddingHorizontal: 16, minHeight: 44, justifyContent: "center", borderRadius: 999, backgroundColor: on ? t.primary : t.card, borderWidth: 1, borderColor: on ? t.primary : t.border }}>
              <Text style={{ color: on ? t.onPrimary : t.text, fontSize: 14, fontWeight: "600" }}>{o.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "600", letterSpacing: -0.2, color: t.text }}>{children}</Text>;
}

/**
 * The company's logo, or the website's monogram (initials on the dark square, then the name) when it has none. `bare` shows only the mark.
 * The logo image is a public address, so it needs no sign-in header.
 */
export function BrandMark({ name, logoUrl, size = "md", bare }: { name: string; logoUrl?: string | null; size?: "sm" | "md" | "lg"; bare?: boolean }) {
  const t = useTheme();
  const box = size === "lg" ? 40 : size === "md" ? 30 : 22;
  const r = size === "lg" ? 10 : size === "md" ? 8 : 6;
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "\u2022";
  if (logoUrl) return <Image accessibilityLabel={name} source={{ uri: logoUrl.startsWith("/") ? `${API_URL}${logoUrl}` : logoUrl }} resizeMode="contain" style={{ height: box, width: box * 4, maxWidth: 160 }} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
      <View style={{ width: box, height: box, borderRadius: r, backgroundColor: t.primary, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: t.onPrimary, fontWeight: "700", fontSize: size === "lg" ? 15 : size === "md" ? 12 : 10 }}>{initials}</Text>
      </View>
      {bare ? null : <Text numberOfLines={1} style={{ flexShrink: 1, color: t.text, fontWeight: "600", letterSpacing: -0.2, fontSize: size === "lg" ? 20 : size === "md" ? 15 : 13 }}>{name}</Text>}
    </View>
  );
}
