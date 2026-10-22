import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Field, Screen } from "@/components/ui";

export default function Login() {
  const t = useTheme();
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not sign in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6, marginBottom: space.md }}>
            <Text accessibilityRole="header" style={{ fontSize: 30, fontWeight: "700", color: t.text }}>Sign in</Text>
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
          <Button label="Sign in" onPress={submit} busy={busy} />
          <Text style={{ color: t.muted, fontSize: 13, textAlign: "center" }}>
            No account yet, or forgot your password? Use the website to create a company or reset it.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
