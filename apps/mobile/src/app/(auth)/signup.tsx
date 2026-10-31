import { useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { ApiError } from "@/lib/client";
import { COUNTRIES } from "@/lib/countries";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Chips, Field, Muted, Screen } from "@/components/ui";
import { CodeStep } from "@/components/code-step";
import { GoogleButton, googleAvailable } from "@/components/google-button";

const website = (Constants.expoConfig?.extra?.websiteUrl as string | undefined) ?? "";

/** Create a company from the phone: same questions and rules as the website, then the emailed code, then straight in. */
export default function SignUp() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const [v, setV] = useState({ companyName: "", name: "", email: "", phone: "", password: "", country: "IN", acceptTerms: false });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const refs = { name: useRef<React.ComponentRef<typeof TextInput>>(null), phone: useRef<React.ComponentRef<typeof TextInput>>(null), email: useRef<React.ComponentRef<typeof TextInput>>(null), password: useRef<React.ComponentRef<typeof TextInput>>(null) };
  const country = COUNTRIES.find((c) => c.code === v.country) ?? COUNTRIES[0];
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }));
  const err = (field: string) => (error?.field === field ? error.message : null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.signUp({ ...v, email: v.email.trim().toLowerCase() });
      setSentTo(v.email.trim().toLowerCase());
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Could not create your account. Please try again.", field: e instanceof ApiError && e.code !== "invalid_input" && e.code !== "error" ? e.code : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Screen>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }} keyboardShouldPersistTaps="handled">
            <CodeStep email={sentTo} password={v.password} onBack={() => setSentTo(null)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: "700", color: t.text }}>Create your company account</Text>
            <Muted>Start a free trial. You will confirm your email, then set up your team.</Muted>
          </View>

          {googleAvailable ? (
            <View style={{ gap: space.sm }}>
              <GoogleButton label="Sign up with Google" onError={(message) => setError({ message })} />
              <Muted style={{ textAlign: "center", fontSize: 12 }}>Continuing with Google creates your company on a free trial.</Muted>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
                <Muted style={{ fontSize: 12 }}>or use your email</Muted>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
              </View>
            </View>
          ) : null}

          <Text style={{ fontSize: 12, fontWeight: "700", color: t.muted, letterSpacing: 0.6 }}>YOUR COMPANY</Text>
          <Field label="Company name" value={v.companyName} onChangeText={(x) => set("companyName", x)} maxLength={80} autoComplete="organization" returnKeyType="next" onSubmitEditing={() => refs.name.current?.focus()} error={err("companyName")} />
          <Chips label="Country (sets currency and time zone)" options={COUNTRIES.map((c) => ({ id: c.code, name: c.label }))} value={v.country} onChange={(x) => set("country", x)} />

          <Text style={{ fontSize: 12, fontWeight: "700", color: t.muted, letterSpacing: 0.6, marginTop: space.sm }}>ABOUT YOU</Text>
          <Field inputRef={refs.name} label="Your name" value={v.name} onChangeText={(x) => set("name", x)} maxLength={80} autoComplete="name" returnKeyType="next" onSubmitEditing={() => refs.phone.current?.focus()} error={err("name")} />
          <Field inputRef={refs.phone} label="Mobile number" value={v.phone} onChangeText={(x) => set("phone", x)} keyboardType="phone-pad" autoComplete="tel" placeholder={country.example} returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()} error={err("phone")} />
          <Muted style={{ marginTop: -space.sm, fontSize: 12 }}>{country.hint}</Muted>
          <Field inputRef={refs.email} label="Work email" value={v.email} onChangeText={(x) => set("email", x)} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" returnKeyType="next" onSubmitEditing={() => refs.password.current?.focus()} error={err("email")} />
          <Field inputRef={refs.password} label="Password" value={v.password} onChangeText={(x) => set("password", x)} secureTextEntry textContentType="newPassword" autoComplete="new-password" returnKeyType="go" onSubmitEditing={submit} error={err("password")} />
          <Muted style={{ marginTop: -space.sm, fontSize: 12 }}>At least 10 characters. A few random words make a strong password.</Muted>

          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: v.acceptTerms }} onPress={() => set("acceptTerms", !v.acceptTerms)} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", minHeight: 44 }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: err("acceptTerms") ? t.danger : t.border, backgroundColor: v.acceptTerms ? t.primary : t.card, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
              {v.acceptTerms ? <Text style={{ color: t.onPrimary, fontSize: 14, fontWeight: "700" }}>✓</Text> : null}
            </View>
            <Text style={{ flex: 1, color: t.text, fontSize: 14, lineHeight: 20 }}>
              I agree to the terms of service and privacy policy
              {website ? (
                <Text style={{ color: t.muted }} onPress={() => void Linking.openURL(website)}>{" "}(read them on our website)</Text>
              ) : null}
              .
            </Text>
          </Pressable>
          {err("acceptTerms") ? <Text style={{ color: t.danger, fontSize: 13 }}>{err("acceptTerms")}</Text> : null}
          {error && !error.field ? <Text style={{ color: t.danger, fontSize: 14 }}>{error.message}</Text> : null}

          <Button label="Create account" onPress={submit} busy={busy} />
          <Button label="I already have an account" variant="outline" onPress={() => router.replace("/login")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
