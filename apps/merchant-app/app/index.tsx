import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text } from "react-native";
import {
  hasRuntimeMerchantSession,
  logoutMerchant,
  restoreMerchantSession,
} from "../src/auth/session";

type StartupState = "loading" | "authenticated" | "signed-out" | "offline" | "error";

function isLikelyNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message));
}

export default function MerchantEntryScreen() {
  const [state, setState] = useState<StartupState>(hasRuntimeMerchantSession() ? "authenticated" : "loading");
  const [message, setMessage] = useState("");

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
    void restore();
  }, [restore]);

  async function signOut() {
    try {
      await logoutMerchant();
    } finally {
      setState("signed-out");
      setMessage("");
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.title}>MyPet Merchant</Text>

      {state === "loading" ? <Text accessibilityRole="status">Restoring your secure session…</Text> : null}

      {state === "authenticated" ? (
        <>
          <Text style={styles.body}>Merchant session active.</Text>
          <Button title="Sign out" onPress={() => void signOut()} accessibilityLabel="Sign out of MyPet Merchant" />
        </>
      ) : null}

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 16, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700" },
  body: { fontSize: 16, color: "#4b5563", textAlign: "center" },
});
