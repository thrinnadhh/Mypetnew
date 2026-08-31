import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { MerchantDatabaseProvider, useMerchantDatabase } from "../src/data";

function RootNavigation() {
  const { isLoading, error, isReady } = useMerchantDatabase();

  if (isLoading) {
    return (
      <View style={styles.centerContainer} testID="database-loading-view">
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>Initializing offline database...</Text>
      </View>
    );
  }

  if (error || !isReady) {
    return (
      <View style={styles.centerContainer} testID="database-error-view">
        <Text style={styles.errorTitle}>Offline Database Error</Text>
        <Text style={styles.errorMessage}>
          {error?.message ?? "Failed to initialize offline database"}
        </Text>
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "MyPet Merchant" }} />
      <Stack.Screen name="login" options={{ title: "Merchant sign in" }} />
      <Stack.Screen name="dashboard" options={{ title: "Operations dashboard" }} />
      <Stack.Screen name="staff" options={{ title: "Staff permissions" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="orders" options={{ title: "Order work" }} />
      <Stack.Screen name="sync-status" options={{ title: "Sync & conflicts" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <MerchantDatabaseProvider>
      <StatusBar style="auto" />
      <RootNavigation />
    </MerchantDatabaseProvider>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#ffffff",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: "#64748b",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#ef4444",
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
  },
});
