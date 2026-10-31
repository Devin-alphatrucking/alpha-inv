import { useEffect, useState } from "react";
import Constants from "expo-constants";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@/lib/client";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui";

WebBrowser.maybeCompleteAuthSession();

type GoogleIds = { web?: string; ios?: string; android?: string };
const ids = (Constants.expoConfig?.extra?.googleClientIds ?? {}) as GoogleIds;

/** Google sign-in is offered only when this build has Google client ids (see docs/PHASE-20-MOBILE-SIGN-UP.md). */
export const googleAvailable = Boolean(ids.web || ids.ios || ids.android);

/**
 * "Continue with Google": the phone's own Google sign-in gives an ID token, the server checks it and signs the person in (or creates their
 * company on a free trial, exactly as the website's Google button does). It must only be rendered when `googleAvailable` is true,
 * because the Google hook needs a client id for the phone's platform.
 */
export function GoogleButton({ label = "Continue with Google", onError, onDone }: { label?: string; onError: (message: string) => void; onDone?: (created: boolean) => void }) {
  const { signInWithGoogle } = useSession();
  const [busy, setBusy] = useState(false);
  const [request, response, prompt] = Google.useIdTokenAuthRequest({ webClientId: ids.web, iosClientId: ids.ios, androidClientId: ids.android });

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const idToken = response.params?.id_token ?? response.authentication?.idToken;
      if (!idToken) {
        setBusy(false);
        return onError("Google did not send a sign-in. Please try again, or use your email and password.");
      }
      signInWithGoogle(idToken)
        .then((r) => onDone?.(r.created))
        .catch((e) => onError(e instanceof ApiError ? e.message : "Google sign-in did not work. Please try again, or use your email and password."))
        .finally(() => setBusy(false));
    } else {
      setBusy(false);
      if (response.type === "error") onError("Google sign-in did not work. Please try again, or use your email and password.");
    }
    // Only a new answer from Google matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <Button
      label={label}
      variant="outline"
      busy={busy}
      disabled={!request}
      onPress={() => {
        setBusy(true);
        void prompt().catch(() => {
          setBusy(false);
          onError("Could not open Google sign-in. Please try again.");
        });
      }}
    />
  );
}
