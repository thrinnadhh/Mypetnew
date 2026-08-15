import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export default function WalletScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="My Loyalty" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in to view loyalty"
          message="Your loyalty stars are stored separately for each merchant."
          actionLabel="Sign In"
          onAction={() => void requireAuth({ action: 'CHECKOUT', returnTo: '/wallet' })}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title="My Loyalty" subtitle="Merchant-specific Sprint 1 loyalty" />}>
      <View style={styles.container}>
        <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.titleRow}>
            <AppIcon name="sparkle" size={22} color={theme.primary} />
            <ThemedText style={styles.title}>Loyalty belongs to each merchant</ThemedText>
          </View>
          <ThemedText themeColor="textSecondary">
            Open a product store to see its server-authoritative star balance and issued reward count. MyPet does not combine stars from different merchants into one wallet.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Sprint 1 does not expose legacy global reward codes, welcome-star claims, or online-payment promotions from this screen.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse product stores"
            onPress={() => router.push('/home' as never)}
            style={[styles.action, { backgroundColor: theme.primary }]}
          >
            <ThemedText style={styles.actionText}>Browse stores</ThemedText>
          </Pressable>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  title: { ...typography.title, fontWeight: '800', flex: 1 },
  action: { minHeight: 48, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.x4 },
  actionText: { color: '#FFFFFF', fontWeight: '800' },
});