import { router } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveDeliveryCard } from '../../components/ActiveDeliveryCard';
import { CaptainHeader } from '../../components/CaptainHeader';
import { DeliveryOfferCard } from '../../components/DeliveryOfferCard';
import { LocationStatusBanner } from '../../components/LocationStatusBanner';
import { MoneyAmount } from '../../components/MoneyAmount';
import { OnlineToggle } from '../../components/OnlineToggle';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useCaptainStore } from '../../state/captain-store';
import { useDeliveryStore } from '../../state/delivery-store';

export default function HomeScreen() {
  const { profile, isOnline, isUpdatingPresence, presenceError, setOnline } = useCaptainStore();
  const {
    activeDelivery,
    activeOffer,
    refreshOffers,
    acceptOffer,
    rejectOffer,
    deliveryError,
    dismissError,
  } = useDeliveryStore();

  const [offerActionLoading, setOfferActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Poll for offers periodically when online and not busy with an active job
  useEffect(() => {
    if (!isOnline || activeDelivery) return;

    refreshOffers();
    const interval = setInterval(() => {
      refreshOffers();
    }, 8000);

    return () => clearInterval(interval);
  }, [isOnline, activeDelivery, refreshOffers]);

  const handleToggleOnline = async () => {
    dismissError();
    await setOnline(!isOnline);
    if (!isOnline) {
      refreshOffers();
    }
  };

  const handleAcceptOffer = async (offerId: string) => {
    setOfferActionLoading(true);
    dismissError();
    try {
      const outcome = await acceptOffer(offerId);
      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.push(`/delivery/${outcome.data.jobId}` as any);
      }
    } finally {
      setOfferActionLoading(false);
    }
  };

  const handleRejectOffer = async (offerId: string) => {
    setOfferActionLoading(true);
    try {
      await rejectOffer(offerId);
    } finally {
      setOfferActionLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (isOnline) {
        await refreshOffers();
      }
    } finally {
      setRefreshing(false);
    }
  }, [isOnline, refreshOffers]);

  const displayedError = presenceError?.message || deliveryError?.message || null;

  return (
    <SafeAreaView style={styles.container}>
      <CaptainHeader name={profile?.name} online={isOnline} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} />
        }
      >
        {displayedError ? (
          <LocationStatusBanner
            actionText="Dismiss"
            message={displayedError}
            onPressAction={dismissError}
          />
        ) : null}

        <OnlineToggle
          loading={isUpdatingPresence}
          onToggle={handleToggleOnline}
          online={isOnline}
        />

        {/* Active Job Section */}
        {activeDelivery ? (
          <ActiveDeliveryCard
            delivery={activeDelivery}
            onContinue={() => router.push(`/delivery/${activeDelivery.jobId}` as any)}
          />
        ) : null}

        {/* Incoming Offer Section */}
        {!activeDelivery && activeOffer ? (
          <DeliveryOfferCard
            loading={offerActionLoading}
            offer={activeOffer}
            onAccept={() => handleAcceptOffer(activeOffer.offerId)}
            onExpired={() => rejectOffer(activeOffer.offerId)}
            onReject={() => handleRejectOffer(activeOffer.offerId)}
          />
        ) : null}

        {/* Waiting For Orders Card */}
        {isOnline && !activeDelivery && !activeOffer ? (
          <View style={styles.waitingCard}>
            <View style={styles.radarPulse}>
              <Text style={styles.radarIcon}>📡</Text>
            </View>
            <Text style={styles.waitingTitle}>Searching for delivery orders…</Text>
            <Text style={styles.waitingDesc}>
              Keep the app open or in the background. We will notify you when a nearby order is assigned.
            </Text>

            <View style={styles.statusChipsRow}>
              <View style={styles.statusChip}>
                <Text style={styles.statusDot}>●</Text>
                <Text style={styles.statusChipText}>GPS Active</Text>
              </View>
              <View style={styles.statusChip}>
                <Text style={styles.statusDot}>●</Text>
                <Text style={styles.statusChipText}>Online</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Offline State Summary */}
        {!isOnline && !activeDelivery ? (
          <View style={styles.offlineCard}>
            <Text style={styles.offlineIcon}>🌙</Text>
            <Text style={styles.offlineTitle}>You are currently Offline</Text>
            <Text style={styles.offlineDesc}>
              Go online whenever you are ready to start taking deliveries and earning.
            </Text>
          </View>
        ) : null}

        {/* Today's Metrics */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>TODAY&apos;S DELIVERIES</Text>
            <Text style={styles.metricValue}>0</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>TODAY&apos;S EARNINGS</Text>
            <MoneyAmount paise={0} style={styles.metricEarning} />
          </View>
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
  waitingCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.royalBlueSoft,
    padding: spacing.xl,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  radarPulse: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.royalBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  radarIcon: {
    fontSize: 28,
  },
  waitingTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 17,
    textAlign: 'center',
  },
  waitingDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  statusChipsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.emeraldSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    gap: 4,
  },
  statusDot: {
    color: palette.emerald,
    fontSize: 10,
  },
  statusChipText: {
    ...typography.caption,
    color: '#065F46',
    fontWeight: '700',
  },
  offlineCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  offlineIcon: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  offlineTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 16,
  },
  offlineDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  metricCard: {
    flex: 1,
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
  },
  metricLabel: {
    ...typography.caption,
    color: palette.inkMuted,
    marginBottom: 4,
  },
  metricValue: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 20,
  },
  metricEarning: {
    color: palette.royalBlue,
    fontSize: 20,
  },
});
