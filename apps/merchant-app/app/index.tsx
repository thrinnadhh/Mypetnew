import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  hasRuntimeMerchantSession,
  logoutMerchant,
  restoreMerchantSession,
} from "../src/auth/session";
import {
  ErrorState,
  LoadingState,
  MerchantScreen,
  OfflineBanner,
  PrimaryButton,
  SecondaryButton,
  colors,
  radius,
  spacing,
  typography,
} from "../src/design";
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
      <View style={styles.authenticatedWrapper}>
        <MerchantDashboardContent
          showHomeLink={false}
          onSignOut={() => void signOut()}
        />
      </View>
    );
  }

  return (
    <MerchantScreen
      showHeader={false}
      scrollable
      contentContainerStyle={styles.landingContent}
    >
      <View style={styles.brandHero}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>🏪 Merchant Ops</Text>
        </View>
        <Text style={styles.heroTitle}>MyPet Merchant</Text>
        <Text style={styles.heroSubtitle}>
          Professional store operations, offline inventory ledger & booking management
        </Text>
      </View>

      {state === "loading" && (
        <LoadingState message="Restoring your secure Merchant session…" testID="session-loading-view" />
      )}

      {state === "signed-out" && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In Required</Text>
          <Text style={styles.cardBody}>
            Sign in with your authorized Merchant mobile number (+91) to access your store outlet.
          </Text>
          <PrimaryButton
            title="Sign in with Mobile OTP"
            onPress={() => router.push("/login")}
            accessibilityLabel="Sign in to Merchant App"
            testID="sign-in-cta"
          />
        </View>
      )}

      {state === "offline" && (
        <View style={styles.stateContainer}>
          <OfflineBanner
            variant="offline"
            message={message || "Network offline. Stored offline sessions will activate when connectivity returns."}
            onAction={() => void restore()}
            actionLabel="Retry"
          />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Offline Mode</Text>
            <Text style={styles.cardBody}>
              {message || "Reconnect to internet and retry to authenticate with your Merchant account."}
            </Text>
            <View style={styles.buttonRow}>
              <PrimaryButton
                title="Retry Connection"
                onPress={() => void restore()}
                accessibilityLabel="Retry Merchant session restore"
              />
              <SecondaryButton
                title="Sign in with Mobile OTP"
                onPress={() => router.push("/login")}
                accessibilityLabel="Sign in again"
              />
            </View>
          </View>
        </View>
      )}

      {state === "error" && (
        <View style={styles.stateContainer}>
          <ErrorState
            title="Session Restore Failed"
            message={message}
            onRetry={() => void restore()}
            retryTitle="Retry Restore"
            testID="session-error-view"
          />
          <SecondaryButton
            title="Sign in with Mobile OTP"
            onPress={() => router.push("/login")}
            accessibilityLabel="Sign in again"
          />
        </View>
      )}
    </MerchantScreen>
  );
}

const styles = StyleSheet.create({
  authenticatedWrapper: {
    flex: 1,
    backgroundColor: colors.surfaceDim,
  },
  landingContent: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: "center",
    gap: spacing.lg,
  },
  brandHero: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  brandBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs - 2,
    borderRadius: radius.full,
    marginBottom: spacing.xs,
  },
  brandBadgeText: {
    ...typography.labelSm,
    color: colors.primaryDark,
    fontWeight: "800",
  },
  heroTitle: {
    ...typography.headlineLg,
    color: colors.slate900,
    textAlign: "center",
  },
  heroSubtitle: {
    ...typography.bodyMd,
    color: colors.slate600,
    textAlign: "center",
    maxWidth: 320,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  cardBody: {
    ...typography.bodyMd,
    color: colors.slate600,
    lineHeight: 20,
  },
  stateContainer: {
    gap: spacing.md,
  },
  buttonRow: {
    gap: spacing.sm,
  },
});
