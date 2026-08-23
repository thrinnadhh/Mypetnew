import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../auth/context';
import { OfflineBanner } from '../components/OfflineBanner';
import { palette } from '../design/tokens';
import { CaptainStoreProvider } from '../state/captain-store';
import { DeliveryStoreProvider } from '../state/delivery-store';
import { connectivity } from '../sync/connectivity';

function CaptainAppShell() {
  const [isOnline, setIsOnline] = useState(() => connectivity.online);

  useEffect(() => {
    return connectivity.subscribe((online) => {
      setIsOnline(online);
    });
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <OfflineBanner visible={!isOnline} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.coolWhite },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/otp" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/personal" />
        <Stack.Screen name="onboarding/identity" />
        <Stack.Screen name="onboarding/vehicle" />
        <Stack.Screen name="onboarding/bank" />
        <Stack.Screen name="onboarding/documents" />
        <Stack.Screen name="onboarding/consent" />
        <Stack.Screen name="onboarding/review" />
        <Stack.Screen name="onboarding/status" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="delivery/offer"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="delivery/[jobId]/index" />
        <Stack.Screen name="delivery/[jobId]/pickup" />
        <Stack.Screen name="delivery/[jobId]/pickup-proof" />
        <Stack.Screen name="delivery/[jobId]/customer" />
        <Stack.Screen name="delivery/[jobId]/delivery-proof" />
        <Stack.Screen name="delivery/[jobId]/completed" />
        <Stack.Screen name="permissions/location" />
        <Stack.Screen name="permissions/notifications" />
        <Stack.Screen name="support/index" />
        <Stack.Screen name="support/new" />
        <Stack.Screen name="settings/index" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CaptainStoreProvider>
          <DeliveryStoreProvider>
            <CaptainAppShell />
          </DeliveryStoreProvider>
        </CaptainStoreProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
});
