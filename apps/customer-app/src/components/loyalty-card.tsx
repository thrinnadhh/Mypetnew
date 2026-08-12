import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { StatusBadge } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  claimWelcomeStar,
  fetchLoyaltyProgress,
  type LoyaltyProgressDto,
} from '@/services/loyalty';

interface LoyaltyCardProps {
  providerId?: string;
  progress?: LoyaltyProgressDto;
  accessToken?: string | null;
  onProgressUpdated?: (updated: LoyaltyProgressDto) => void;
}

export function LoyaltyCard({
  providerId,
  progress,
  accessToken,
  onProgressUpdated,
}: LoyaltyCardProps) {
  const theme = useTheme();
  const { session } = useAuth();
  const effectiveAccessToken = accessToken ?? session?.access_token ?? null;
  const effectiveProviderId = providerId ?? progress?.providerId ?? null;
  const [currentProgress, setCurrentProgress] = useState<LoyaltyProgressDto | null>(
    progress ?? null,
  );
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (progress) {
      setCurrentProgress(progress);
      return;
    }
    if (!effectiveProviderId || !effectiveAccessToken) {
      setCurrentProgress(null);
      return;
    }

    let active = true;
    void fetchLoyaltyProgress(effectiveProviderId, effectiveAccessToken)
      .then((value) => {
        if (active) setCurrentProgress(value);
      })
      .catch((error) => {
        if (active) {
          setCurrentProgress(null);
          console.warn('Could not load store loyalty progress', error);
        }
      });

    return () => {
      active = false;
    };
  }, [effectiveAccessToken, effectiveProviderId, progress]);

  if (!currentProgress) return null;

  const handleClaimWelcomeStar = async () => {
    if (!effectiveAccessToken || claiming) return;
    setClaiming(true);
    try {
      const updated = await claimWelcomeStar(
        currentProgress.providerId,
        effectiveAccessToken,
      );
      setCurrentProgress(updated);
      onProgressUpdated?.(updated);
      Alert.alert(
        'Welcome Star Claimed! ⭐',
        'Your first star has been added to your loyalty card.',
      );
    } catch (error) {
      Alert.alert(
        'Claim Failed',
        error instanceof Error ? error.message : 'Could not claim welcome star.',
      );
    } finally {
      setClaiming(false);
    }
  };

  const stars = Array.from(
    { length: currentProgress.targetStars || 10 },
    (_, index) => index < currentProgress.starBalance,
  );

  return (
    <View
      style={[
        styles.card,
        shadows.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
      testID="loyalty-card"
      accessibilityLabel={`Store loyalty: ${currentProgress.starBalance} of ${currentProgress.targetStars} stars`}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <AppIcon name="sparkle" size={20} color={theme.primary} />
          <ThemedText style={styles.cardTitle}>Store Loyalty Rewards</ThemedText>
        </View>
        <StatusBadge
          label={
            currentProgress.isProgramActive
              ? `${currentProgress.starBalance}/${currentProgress.targetStars} Stars`
              : 'Paused'
          }
          tone={currentProgress.isProgramActive ? 'success' : 'neutral'}
        />
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
            <AppIcon
              name="sparkle"
              size={16}
              color={filled ? '#FFFFFF' : theme.textSecondary}
            />
          </View>
        ))}
      </View>

      <ThemedText style={styles.rewardCopy}>
        Collect {currentProgress.targetStars} stars to get ₹{currentProgress.rewardAmount} off your next order!
      </ThemedText>

      <View style={styles.rulesRow}>
        <ThemedText type="small" themeColor="textSecondary">
          • Min order amount: ₹{currentProgress.minOrderValue}
        </ThemedText>
        {currentProgress.cycleCount > 0 ? (
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
            • Completed cycles: {currentProgress.cycleCount}
          </ThemedText>
        ) : null}
      </View>

      {!currentProgress.welcomeStarClaimed &&
      currentProgress.isProgramActive &&
      effectiveAccessToken ? (
        <Pressable
          style={[
            styles.claimBtn,
            { backgroundColor: theme.primary, opacity: claiming ? 0.6 : 1 },
          ]}
          onPress={() => void handleClaimWelcomeStar()}
          disabled={claiming}
          accessibilityRole="button"
          accessibilityLabel="Add your first welcome star"
          accessibilityState={{ disabled: claiming }}
        >
          <AppIcon name="sparkle" size={16} color="#FFF" />
          <ThemedText style={styles.claimBtnText}>
            {claiming ? 'Claiming...' : 'Add your first star (+1 ⭐)'}
          </ThemedText>
        </Pressable>
      ) : null}
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
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    paddingVertical: spacing.x3,
    borderRadius: radii.compact,
    marginTop: spacing.x1,
  },
  claimBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
});
