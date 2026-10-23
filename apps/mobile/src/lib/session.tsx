import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type ApiClient, type Me } from "./client";

// The refresh token lives in the phone's secure storage (iOS Keychain / Android Keystore). The access token stays in memory.
const KEY = "refresh-token";
const store = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (v: string) => SecureStore.setItemAsync(KEY, v),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:3000";

type Status = "loading" | "signedOut" | "signedIn";

type Session = {
  status: Status;
  me: Me | null;
  client: ApiClient;
  /** Shown on the login screen when the session ended on its own ("You were signed out"). */
  notice: string | null;
  signIn(email: string, password: string, totp?: string): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
  switchCompany(companyId: string): Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signedInRef = useRef(false);

  const client = useMemo(
    () =>
      createClient({
        baseUrl: API_URL,
        store,
        onSignedOut: () => {
          if (signedInRef.current) setNotice("You were signed out. Please sign in again.");
          signedInRef.current = false;
          setMe(null);
          setStatus("signedOut");
        },
      }),
    [],
  );

  const reload = useCallback(async () => {
    const m = await client.me();
    signedInRef.current = true;
    setMe(m);
    setStatus("signedIn");
  }, [client]);

  // On start: if a refresh token is saved, confirm it with the server; otherwise show the login screen.
  useEffect(() => {
    (async () => {
      if (!(await client.hasSession())) return setStatus("signedOut");
      try {
        await reload();
      } catch {
        // No connection at start: keep the saved sign-in and show the app shell; screens retry on their own.
        if (await client.hasSession()) setStatus("signedIn");
        else setStatus("signedOut");
      }
    })();
  }, [client, reload]);

  const value = useMemo<Session>(
    () => ({
      status,
      me,
      client,
      notice,
      async signIn(email, password, totp) {
        setNotice(null);
        await client.signIn(email, password, { deviceName: Constants.deviceName ?? undefined, platform: Platform.OS === "ios" ? "ios" : "android", appVersion: Constants.expoConfig?.version, ...(totp ? { totp } : {}) });
        await reload();
      },
      async signOut() {
        await client.signOut();
        signedInRef.current = false;
        setMe(null);
        setStatus("signedOut");
      },
      reload,
      async switchCompany(companyId) {
        await client.switchCompany(companyId);
        await reload();
      },
    }),
    [status, me, client, notice, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
