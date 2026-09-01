import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MerchantDatabaseProvider, useMerchantDatabase } from "../src/data";
import { ErrorState, LoadingState, colors } from "../src/design";

function RootNavigation() {
  const { isLoading, error, isReady } = useMerchantDatabase();

  if (isLoading) {
    return (
      <View style={styles.centerContainer} testID="database-loading-view">
        <LoadingState message="Initializing offline SQLite database…" />
      </View>
    );
  }

  if (error || !isReady) {
    return (
      <View style={styles.centerContainer} testID="database-error-view">
        <ErrorState
          title="Offline Database Error"
          message={error?.message ?? "Failed to initialize offline database"}
        />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontWeight: "700", color: colors.slate900 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surfaceDim },
      }}
    >
      <Stack.Screen name="index" options={{ title: "MyPet Merchant" }} />
      <Stack.Screen name="login" options={{ title: "Merchant Sign In" }} />
      <Stack.Screen name="dashboard" options={{ title: "Operations Dashboard" }} />
      <Stack.Screen name="inventory" options={{ title: "Inventory & Stock" }} />
      <Stack.Screen name="catalog" options={{ title: "Catalog & Products" }} />
      <Stack.Screen name="barcode" options={{ title: "Barcode Scanner & Drafts" }} />
      <Stack.Screen name="orders" options={{ title: "Order Fulfilment" }} />
      <Stack.Screen name="appointments" options={{ title: "Booking Requests" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="staff" options={{ title: "Staff Permissions" }} />
      <Stack.Screen name="sync-status" options={{ title: "Sync & Conflicts" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MerchantDatabaseProvider>
        <StatusBar style="dark" />
        <RootNavigation />
      </MerchantDatabaseProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: colors.surfaceDim,
  },
});
