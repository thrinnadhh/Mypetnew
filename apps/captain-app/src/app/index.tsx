import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context';
import { palette, spacing, typography } from '../design/tokens';
import { useDeliveryStore } from '../state/delivery-store';

export default function SplashScreen() {
  const { session, captainProfile, isRestoring, isLoading } = useAuth();
  const { activeDelivery, restoreActiveDelivery } = useDeliveryStore();

  useEffect(() => {
    if (isRestoring || isLoading) return;

    if (!session) {
      router.replace('/auth/login');
      return;
    }

    const status = captainProfile?.status;

    if (status === 'DRAFT') {
      router.replace('/onboarding/personal');
      return;
    }

    if (
      status === 'SUBMITTED' ||
      status === 'UNDER_REVIEW' ||
      status === 'PENDING_REVIEW' ||
      status === 'REJECTED' ||
      status === 'SUSPENDED'
    ) {
      router.replace('/onboarding/status');
      return;
    }

    if (status === 'ACTIVE') {
      restoreActiveDelivery().then(() => {
        if (activeDelivery && activeDelivery.state !== 'DELIVERED') {
          router.replace(`/delivery/${activeDelivery.jobId}` as any);
        } else {
          router.replace('/(tabs)/home');
        }
      });
      return;
    }

    // Default fallback
    router.replace('/(tabs)/home');
  }, [session, captainProfile, isRestoring, isLoading, activeDelivery, restoreActiveDelivery]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoIcon}>🐾</Text>
        </View>
        <Text style={styles.brandTitle}>MyPet Captain</Text>
        <Text style={styles.subtitle}>Delivery Partner App</Text>

        <View style={styles.loadingContainer}>
          <ActivityIndicator color={palette.royalBlue} size="large" />
          <Text style={styles.loadingText}>Restoring session…</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoIcon: {
    fontSize: 40,
  },
  brandTitle: {
    ...typography.display,
    color: palette.royalBlue,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    ...typography.title,
    color: palette.inkMuted,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  loadingContainer: {
    marginTop: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
  },
});
