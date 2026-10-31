import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Field, Muted, Screen } from "@/components/ui";
import { GoogleButton, googleAvailable } from "@/components/google-button";

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Two-step sign-in: after the password is accepted the server asks for the code from the authenticator app.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, code.trim() || undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code === "totp_required") {
        setNeedsCode(true);
        setError(null);
      } else {
        if (e instanceof ApiError && e.code === "totp_invalid") {
          setNeedsCode(true);
          setCode("");
        }
        setError(e instanceof ApiError ? e.message : "Could not sign in. Please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6, marginBottom: space.md }}>
            <Text style={{ color: t.muted, fontSize: 14, fontWeight: "600" }}>{Constants.expoConfig?.name ?? "Invoice & Billing"}</Text>
            <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: "700", color: t.text }}>Welcome back</Text>
            <Text style={{ color: t.muted, fontSize: 15 }}>Use the same email and password as on the website.</Text>
          </View>
          {notice ? <Text style={{ color: t.warn, fontSize: 14 }}>{notice}</Text> : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            inputRef={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={submit}
            error={error}
          />
          {needsCode ? (
            <Field
              label="Code from your authenticator app"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={submit}
              placeholder="123456 (or a recovery code)"
            />
          ) : null}
          <Button label="Sign in" onPress={submit} busy={busy} />
          <Text accessibilityRole="link" onPress={() => router.push("/forgot")} style={{ color: t.muted, fontSize: 14, textAlign: "center", textDecorationLine: "underline", paddingVertical: space.sm }}>
            Forgot your password?
          </Text>
          {googleAvailable ? (
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
                <Muted style={{ fontSize: 12 }}>or</Muted>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
              </View>
              <GoogleButton label="Continue with Google" onError={setError} />
            </View>
          ) : null}
          <Button label="Create a company account" variant="outline" onPress={() => router.push("/signup")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
