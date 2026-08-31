import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  hasRuntimeMerchantSession,
  logoutMerchant,
  restoreMerchantSession,
} from "../src/auth/session";
import { MerchantDashboardContent } from "./dashboard";

type StartupState = "loading" | "authenticated" | "signed-out" | "offline" | "error";

function isLikelyNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message));
}

export default function MerchantEntryScreen() {
  const [state, setState] = useState<StartupState>(hasRuntimeMerchantSession() ? "authenticated" : "loading");
  const [message, setMessage] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const restore = useCallback(async () => {
    if (hasRuntimeMerchantSession()) {
      setState("authenticated");
      return;
    }
    setState("loading");
    setMessage("");
    try {
      const restored = await restoreMerchantSession();
      setState(restored ? "authenticated" : "signed-out");
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        setState("offline");
        setMessage("You appear to be offline. Reconnect and retry to restore your Merchant session.");
      } else if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
        setState("signed-out");
      } else {
        setState("error");
        setMessage("Your Merchant session could not be restored. Sign in again if retry does not work.");
      }
    }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => void restore(), 0);
    return () => clearTimeout(startup);
  }, [restore]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setMessage("");
    try {
      await logoutMerchant();
      setState("signed-out");
    } catch (error) {
      if (!hasRuntimeMerchantSession()) setState("signed-out");
      else {
        setState("authenticated");
        setMessage(isLikelyNetworkError(error)
          ? "Sign out did not complete while offline. Reconnect and try again."
          : "Sign out did not complete. Try again.");
      }
    } finally {
      setSigningOut(false);
    }
  }

  if (state === "authenticated") {
    return (
      <SafeAreaView style={styles.page}>
        <MerchantDashboardContent showHomeLink={false} />
        <View style={styles.sessionActions}>
          {message ? <Text accessibilityRole="alert" style={styles.body}>{message}</Text> : null}
          <Button
            title={signingOut ? "Signing out…" : "Sign out"}
            disabled={signingOut}
            onPress={() => void signOut()}
            accessibilityLabel="Sign out of MyPet Merchant"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>MyPet Merchant</Text>
        {state === "loading" ? <Text accessibilityLiveRegion="polite">Restoring your secure session…</Text> : null}
        {state === "signed-out" ? (
          <>
            <Text style={styles.body}>Sign in with your authorized Merchant mobile number to continue.</Text>
            <Link href="/login" accessibilityRole="button">Sign in</Link>
          </>
        ) : null}
        {state === "offline" || state === "error" ? (
          <>
            <Text accessibilityRole="alert" style={styles.body}>{message}</Text>
            <Button title="Retry" onPress={() => void restore()} accessibilityLabel="Retry Merchant session restore" />
            <Link href="/login" accessibilityRole="button">Sign in again</Link>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },
  content: { flexGrow: 1, padding: 24, alignItems: "center", gap: 16 },
  title: { fontSize: 26, fontWeight: "700" },
  body: { fontSize: 16, color: "#4b5563", textAlign: "center" },
  sessionActions: { paddingHorizontal: 24, paddingBottom: 16, gap: 8 },
});
