import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Field, Muted, Screen } from "@/components/ui";

/** Forgot your password: email a code, then choose a new one with it. The answer never says whether the address has an account. */
export default function Forgot() {
  const t = useTheme();
  const router = useRouter();
  const { client } = useSession();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy) return;
    if (!email.trim()) return setError("Enter your email.");
    setBusy(true);
    setError(null);
    try {
      const r = await client.forgotPassword(email);
      setNote(r.message);
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    if (code.trim().length !== 6) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    setError(null);
    try {
      await client.resetPassword({ email, code, password });
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          {step === "done" ? (
            <View style={{ gap: space.lg }}>
              <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "600", color: t.text }}>Password changed</Text>
              <Muted>You can sign in with your new password now.</Muted>
              <Button label="Go to sign in" onPress={() => router.replace("/login")} />
            </View>
          ) : (
            <>
              <View style={{ gap: 6 }}>
                <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "600", color: t.text }}>Reset your password</Text>
                <Muted>{step === "email" ? "Enter your email and we will send you a 6-digit code." : "Enter the code we emailed you and choose a new password."}</Muted>
              </View>
              <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={step === "email"} returnKeyType="go" onSubmitEditing={step === "email" ? send : undefined} error={step === "email" ? error : null} />
              {step === "code" ? (
                <>
                  {note ? <Text style={{ color: t.ok, fontSize: 14 }}>{note}</Text> : null}
                  <Field label="6-digit code" value={code} onChangeText={(x) => setCode(x.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} placeholder="123456" autoFocus />
                  <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" returnKeyType="go" onSubmitEditing={reset} error={error} />
                  <Muted style={{ marginTop: -space.sm, fontSize: 12 }}>At least 10 characters.</Muted>
                </>
              ) : null}
              <Button label={step === "email" ? "Send me a code" : "Change password"} onPress={step === "email" ? send : reset} busy={busy} />
              {step === "code" ? <Button label="Send a new code" variant="outline" onPress={() => { setStep("email"); setCode(""); setError(null); }} /> : null}
              <Button label="Back to sign in" variant="outline" onPress={() => router.replace("/login")} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
