import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StatusBadge } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { fetchPublicOutlet } from '@/services/customer-catalog';
import {
  fetchCustomerLoyaltyBalance,
  type CustomerLoyaltyBalanceResponse,
} from '@/services/loyalty';

interface LoyaltyCardProps {
  providerId?: string;
  organizationId?: string;
  accessToken?: string | null;
}

const TARGET_STARS = 10;

export function LoyaltyCard({ providerId, organizationId, accessToken }: LoyaltyCardProps) {
  const theme = useTheme();
  const { session } = useAuth();
  const effectiveAccessToken = accessToken ?? session?.accessToken ?? null;
  const [balance, setBalance] = useState<CustomerLoyaltyBalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!effectiveAccessToken || (!organizationId && !providerId)) {
      setBalance(null);
      return;
    }

    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const resolvedOrganizationId = organizationId
          ?? (providerId ? (await fetchPublicOutlet(providerId)).organizationId : null);
        if (!resolvedOrganizationId) {
          if (active) setBalance(null);
          return;
        }
        const next = await fetchCustomerLoyaltyBalance(resolvedOrganizationId, effectiveAccessToken);
        if (active) setBalance(next);
      } catch (error) {
        if (active) {
          setBalance(null);
          console.warn('Could not load canonical store loyalty balance', error);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveAccessToken, organizationId, providerId]);

  const stars = useMemo(
    () => Array.from({ length: TARGET_STARS }, (_, index) => index < (balance?.availableStars ?? 0)),
    [balance?.availableStars],
  );

  if (!effectiveAccessToken) return null;
  if (loading && !balance) {
    return (
      <View style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">Loading store loyalty…</ThemedText>
      </View>
    );
  }
  if (!balance) return null;

  return (
    <View
      style={[styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
      testID="loyalty-card"
      accessibilityLabel={`Store loyalty: ${balance.availableStars} of ${TARGET_STARS} stars`}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <AppIcon name="sparkle" size={20} color={theme.primary} />
          <ThemedText style={styles.cardTitle}>Store Loyalty Rewards</ThemedText>
        </View>
        <StatusBadge label={`${balance.availableStars}/${TARGET_STARS} Stars`} tone="success" />
      </View>

      <View style={styles.starsGrid}>
        {stars.map((filled, index) => (
          <View
            key={index}
            style={[
              styles.starBubble,
              {
                backgroundColor: filled ? theme.primary : theme.background,
                borderColor: filled ? theme.primary : theme.border,
              },
            ]}
            accessibilityLabel={`Star ${index + 1}: ${filled ? 'earned' : 'not earned'}`}
          >
            <AppIcon name="sparkle" size={16} color={filled ? '#FFFFFF' : theme.textSecondary} />
          </View>
        ))}
      </View>

      <ThemedText style={styles.rewardCopy}>
        Complete eligible purchases at this merchant to earn stars. Every 10 stars creates a merchant loyalty reward on the server.
      </ThemedText>

      <View style={styles.rulesRow}>
        <ThemedText type="small" themeColor="textSecondary">
          • Stars are merchant-specific and server-authoritative.
        </ThemedText>
        {balance.rewards > 0 ? (
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
            • Issued rewards: {balance.rewards}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.x2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  cardTitle: { ...typography.label, fontWeight: '700' },
  starsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    justifyContent: 'center',
    marginVertical: spacing.x2,
  },
  starBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardCopy: { ...typography.body, fontWeight: '600', textAlign: 'center' },
  rulesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    alignItems: 'center',
    gap: spacing.x2,
  },
});