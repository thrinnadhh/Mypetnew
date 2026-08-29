import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, View } from "react-native";
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
        setMessage("You appear to be offline. Canonical actions are unavailable until your Merchant session is revalidated.");
      } else if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
        setState("signed-out");
      } else {
        setState("error");
        setMessage("Your Merchant session could not be restored. Sign in again if retry does not work.");
      }
    }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => {
      void restore();
    }, 0);
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
      if (!hasRuntimeMerchantSession()) {
        setState("signed-out");
      } else {
        setState("authenticated");
        setMessage(
          isLikelyNetworkError(error)
            ? "Sign out did not complete while offline. Reconnect and try again."
            : "Sign out did not complete. Try again.",
        );
      }
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.title}>MyPet Merchant</Text>
      {state === "loading" ? <Text accessibilityLiveRegion="polite">Restoring your secure session…</Text> : null}
      {state === "authenticated" ? (
        <>
          <Text style={styles.body}>Merchant session active.</Text>
          <View style={styles.primaryLinkBox}>
            <Text style={styles.primaryLinkTitle}>Catalog management</Text>
            <Text style={styles.primaryLinkBody}>Create products, update price and metadata, search listings, and activate or deactivate safely with version checks.</Text>
            <Link href="/catalog" accessibilityRole="button" style={styles.primaryLink}>Open catalog</Link>
          </View>
          <View style={styles.primaryLinkBox}>
            <Text style={styles.primaryLinkTitle}>Offline product onboarding</Text>
            <Text style={styles.primaryLinkBody}>Capture an unknown barcode, product metadata, and images into a durable local draft. Server reconciliation remains authoritative after reconnect.</Text>
            <Link href="/offline-onboarding" accessibilityRole="button" style={styles.primaryLink}>Open offline onboarding</Link>
          </View>
          <View style={styles.primaryLinkBox}>
            <Text style={styles.primaryLinkTitle}>Barcode lookup</Text>
            <Text style={styles.primaryLinkBody}>Validate GTIN or internal barcodes and resolve existing listings inside the selected Merchant outlet.</Text>
            <Link href="/barcode" accessibilityRole="button" style={styles.primaryLink}>Open barcode lookup</Link>
          </View>
          <View style={styles.primaryLinkBox}>
            <Text style={styles.primaryLinkTitle}>Inventory ledger</Text>
            <Text style={styles.primaryLinkBody}>Review canonical stock, commit whole-unit adjustments, retry safely, and inspect immutable movement history.</Text>
            <Link href="/inventory" accessibilityRole="button" style={styles.primaryLink}>Open inventory</Link>
          </View>
          <View style={styles.primaryLinkBox}>
            <Text style={styles.primaryLinkTitle}>New booking requests</Text>
            <Text style={styles.primaryLinkBody}>Accept or reject grooming and veterinary requests before customers see Confirmed.</Text>
            <Link href="/appointments" accessibilityRole="button" style={styles.primaryLink}>Open booking requests</Link>
          </View>
          {message ? <Text accessibilityRole="alert" style={styles.body}>{message}</Text> : null}
          <Button
            title={signingOut ? "Signing out…" : "Sign out"}
            disabled={signingOut}
            onPress={() => void signOut()}
            accessibilityLabel="Sign out of MyPet Merchant"
          />
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
          {state === "offline" ? (
            <View style={styles.offlineBox}>
              <Text style={styles.primaryLinkTitle}>Local work is still available</Text>
              <Text style={styles.primaryLinkBody}>Reopen previously cached outlet drafts or capture new local work. Nothing will sync until server authorization succeeds.</Text>
              <Link href="/offline-onboarding" accessibilityRole="button" style={styles.primaryLink}>Open offline onboarding</Link>
            </View>
          ) : null}
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
  primaryLinkBox: { width: "100%", maxWidth: 520, gap: 8, padding: 18, borderRadius: 16, backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#bbf7d0" },
  offlineBox: { width: "100%", maxWidth: 520, gap: 8, padding: 18, borderRadius: 16, backgroundColor: "#fff7ed", borderWidth: 1, borderColor: "#fed7aa" },
  primaryLinkTitle: { fontSize: 18, fontWeight: "800", color: "#14532d" },
  primaryLinkBody: { fontSize: 14, lineHeight: 20, color: "#166534" },
  primaryLink: { color: "#166534", fontWeight: "800", paddingVertical: 6 },
});
