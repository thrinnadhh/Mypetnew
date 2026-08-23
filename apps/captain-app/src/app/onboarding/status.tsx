import { router } from 'expo-router';
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/context';
import { Button } from '../../components/Button';
import { CaptainStatusCard } from '../../components/CaptainStatusCard';
import { palette, spacing, typography } from '../../design/tokens';

export default function ApprovalStatusScreen() {
  const { captainProfile, refreshProfile, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const status = captainProfile?.status || 'SUBMITTED';

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await refreshProfile();
      if (updated?.status === 'ACTIVE') {
        router.replace('/(tabs)/home');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleAction = () => {
    if (status === 'REJECTED') {
      router.push('/onboarding/personal');
    } else if (status === 'SUSPENDED') {
      router.push('/support');
    } else if (status === 'ACTIVE') {
      router.replace('/(tabs)/home');
    } else {
      onRefresh();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Captain Verification Status</Text>
          <Text style={styles.subtitle}>
            Your status updates in real-time as our onboarding team verifies your details.
          </Text>
        </View>

        <CaptainStatusCard
          onAction={handleAction}
          rejectionReason={captainProfile?.rejectionReason}
          status={status}
        />

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Verification Timeline</Text>
          <Text style={styles.infoDesc}>
            Identity and license reviews are typically processed within 24–48 hours. You will receive an SMS and push notification once your account is active.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            loading={refreshing}
            onPress={onRefresh}
            title="Check for Updates"
            variant="outline"
          />

          <Button
            onPress={() => logout().then(() => router.replace('/auth/login'))}
            style={styles.logoutBtn}
            title="Log Out"
            variant="destructive"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    marginVertical: spacing.md,
  },
  infoTitle: {
    ...typography.label,
    color: palette.ink,
    marginBottom: 4,
  },
  infoDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    lineHeight: 18,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  logoutBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.error,
  },
});
