import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Button, Field, Muted } from "@/components/ui";

/**
 * "Enter the 6-digit code we emailed you": confirms the address, then signs the person in with the password they just chose
 * (so nobody has to type it twice). A resend is available after 30 seconds, the same as on the website.
 */
export function CodeStep({ email, password, onBack }: { email: string; password: string; onBack: () => void }) {
  const t = useTheme();
  const { client, signIn } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(30);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function confirm() {
    if (busy) return;
    if (code.trim().length !== 6) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    setError(null);
    try {
      await client.confirmEmail(email, code);
    } catch (e) {
      setCode("");
      setError(e instanceof ApiError ? e.message : "Could not check the code. Please try again.");
      setBusy(false);
      return;
    }
    try {
      await signIn(email, password); // the screens switch on their own once signed in
    } catch {
      setError("Your email is confirmed. Please sign in with your password.");
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNote(null);
    try {
      const r = await client.resendCode(email);
      setNote(r.message);
      setWait(30);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send a new code. Please try again.");
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "600", color: t.text }}>Check your email</Text>
        <Muted>We sent a 6-digit code to {email}. It works for 10 minutes.</Muted>
      </View>
      <Field
        label="6-digit code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        placeholder="123456"
        returnKeyType="go"
        onSubmitEditing={confirm}
        error={error}
      />
      {note ? <Text style={{ color: t.ok, fontSize: 14 }}>{note}</Text> : null}
      <Button label="Confirm and continue" onPress={confirm} busy={busy} />
      <Button label={wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"} variant="outline" disabled={wait > 0} onPress={resend} />
      <Muted style={{ textAlign: "center" }}>Nothing arrived? Look in your spam folder.</Muted>
      <Button label="Use a different email" variant="outline" onPress={onBack} />
    </View>
  );
}
