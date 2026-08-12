import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, FilterChip, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isOfflineError } from '@/services/customer-profile';
import {
  fetchActivePromotions,
  fetchCustomerWallet,
  type LoyaltyRewardDto,
  type PromotionDto,
} from '@/services/loyalty';

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function promotionLabel(promotion: PromotionDto): string {
  const value = numeric(promotion.discountValue);
  if (promotion.discountType === 'PERCENTAGE') {
    const maximum = numeric(promotion.maxDiscountAmount);
    return maximum > 0 ? `${value}% OFF · up to ₹${maximum}` : `${value}% OFF`;
  }
  return `FLAT ₹${value} OFF`;
}

export default function WalletScreen() {
  const theme = useTheme();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();

  const [rewards, setRewards] = useState<LoyaltyRewardDto[]>([]);
  const [promotions, setPromotions] = useState<PromotionDto[]>([]);
  const [tab, setTab] = useState<'rewards' | 'coupons'>('rewards');
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !session) return;
    setState('loading');
    setErrorMessage(null);
    try {
      const [walletData, promotionData] = await Promise.all([
        fetchCustomerWallet(session.access_token),
        fetchActivePromotions(session.access_token),
      ]);
      setRewards(walletData);
      setPromotions(promotionData);
      setState('ready');
    } catch (error) {
      setRewards([]);
      setPromotions([]);
      setErrorMessage(error instanceof Error ? error.message : 'Could not load wallet items.');
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [session, user]);

  useEffect(() => {
    if (user && session) void loadData();
  }, [loadData, session, user]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="My Loyalty & Wallet" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in to view your wallet"
          message="View your earned store rewards, discounts, and active coupons."
          actionLabel="Sign In"
          onAction={() => void requireAuth({ action: 'CHECKOUT', returnTo: '/wallet' })}
        />
      </ScreenShell>
    );
  }

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="My Loyalty & Wallet" />}>
        <StateView kind="loading" title="Loading wallet items..." />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="My Loyalty & Wallet" />}>
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Wallet unavailable'}
          message={errorMessage ?? 'Could not load wallet items.'}
          actionLabel="Retry"
          onAction={() => void loadData()}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell header={<AppBar title="My Loyalty & Wallet" subtitle="Live rewards and promotions" />}>
      <View style={styles.container}>
        <View style={[styles.policyBanner, { backgroundColor: theme.primarySoft }]}>
          <AppIcon name="sparkle" size={18} color={theme.primary} />
          <ThemedText type="small" style={{ color: theme.primary, flex: 1, fontWeight: '600' }}>
            Store rewards and promo coupons apply according to the server-authoritative checkout policy.
          </ThemedText>
        </View>

        <View style={styles.tabBar}>
          <FilterChip
            label={`Store Rewards (${rewards.length})`}
            selected={tab === 'rewards'}
            onPress={() => setTab('rewards')}
          />
          <FilterChip
            label={`Available Coupons (${promotions.length})`}
            selected={tab === 'coupons'}
            onPress={() => setTab('coupons')}
          />
        </View>

        {tab === 'rewards' ? (
          rewards.length === 0 ? (
            <StateView
              kind="empty"
              title="No Store Rewards Yet"
              message="Complete eligible purchases to earn store stars and rewards."
            />
          ) : (
            <FlatList
              data={rewards}
              keyExtractor={(item) => item.rewardId}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={[styles.rewardCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <View style={styles.cardTop}>
                    <View style={styles.amountCol}>
                      <ThemedText style={styles.rewardAmount}>₹{item.rewardAmount}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">Store Reward Discount</ThemedText>
                    </View>
                    <StatusBadge label={item.status} tone={item.status === 'ISSUED' ? 'success' : 'neutral'} />
                  </View>
                  <View style={[styles.codeBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <ThemedText style={styles.codeText}>{item.code}</ThemedText>
                    <Pressable onPress={() => Alert.alert('Reward Code', `Use ${item.code} during eligible checkout.`)}>
                      <ThemedText style={{ color: theme.primary, fontWeight: '700' }}>View</ThemedText>
                    </Pressable>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    Expires on {new Date(item.expiresAt).toLocaleDateString('en-IN')}
                  </ThemedText>
                </View>
              )}
            />
          )
        ) : promotions.length === 0 ? (
          <StateView
            kind="empty"
            title="No Active Coupons"
            message="New promotions from MyPet and participating stores will appear here."
          />
        ) : (
          <FlatList
            data={promotions}
            keyExtractor={(item) => item.promotionId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.rewardCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={styles.cardTop}>
                  <View style={styles.amountCol}>
                    <ThemedText style={styles.rewardAmount}>{promotionLabel(item)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.providerId ? 'Participating store promotion' : 'MyPet promotion'}
                    </ThemedText>
                  </View>
                  <StatusBadge label="ACTIVE" tone="success" />
                </View>
                <View style={[styles.codeBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <ThemedText style={styles.codeText}>{item.code}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Min order ₹{numeric(item.minOrderValue)}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Valid until {new Date(item.validUntil).toLocaleDateString('en-IN')}
                  {item.applicableCategory ? ` · ${item.applicableCategory}` : ''}
                </ThemedText>
              </View>
            )}
          />
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x3 },
  policyBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2, padding: spacing.x3, borderRadius: radii.card },
  tabBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  listContent: { gap: spacing.x3 },
  rewardCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, gap: spacing.x2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2 },
  amountCol: { flex: 1, gap: 2 },
  rewardAmount: { ...typography.headline, color: '#10B981', fontWeight: '800' },
  codeBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x2, borderWidth: 1, borderStyle: 'dashed', borderRadius: radii.compact, padding: spacing.x3, marginVertical: spacing.x1 },
  codeText: { ...typography.title, letterSpacing: 1 },
});
