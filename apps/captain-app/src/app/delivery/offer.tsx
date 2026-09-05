import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { DeliveryOfferCard } from '../../components/DeliveryOfferCard';
import { OfflineBanner } from '../../components/OfflineBanner';
import { palette, spacing, typography } from '../../design/tokens';
import { useCaptainStore } from '../../state/captain-store';
import { useDeliveryStore } from '../../state/delivery-store';

export default function DeliveryOfferModal() {
  const { isNetworkConnected } = useCaptainStore();
  const { activeOffer, acceptOffer, rejectOffer } = useDeliveryStore();
  const [loading, setLoading] = useState(false);
  const [offerState, setOfferState] = useState<'PENDING' | 'ACCEPTING' | 'LOST' | 'EXPIRED' | 'UNKNOWN'>('PENDING');
  const [error, setError] = useState<string | null>(null);

  if (!activeOffer || offerState === 'EXPIRED' || offerState === 'LOST') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContent}>
          <Text style={styles.emptyIcon}>
            {offerState === 'LOST' ? '⚡' : '⏱️'}
          </Text>
          <Text style={styles.emptyTitle}>
            {offerState === 'LOST'
              ? 'Offer Assigned to Another Captain'
              : 'Delivery Offer Expired'}
          </Text>
          <Text style={styles.emptyDesc}>
            {offerState === 'LOST'
              ? 'This order was accepted by a closer delivery partner.'
              : 'The response window for this delivery offer has closed.'}
          </Text>
          <Button
            onPress={() => router.back()}
            style={styles.backBtn}
            title="Return to Dashboard"
            variant="primary"
          />
        </View>
      </SafeAreaView>
    );
  }

  const handleAccept = async () => {
    setError(null);
    setLoading(true);
    setOfferState('ACCEPTING');
    try {
      const outcome = await acceptOffer(activeOffer.offerId);
      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.replace(`/delivery/${outcome.data.jobId}` as any);
      } else if (outcome.outcome === 'REJECTED') {
        if (outcome.error.code === 'OFFER_UNAVAILABLE' || outcome.error.status === 409) {
          setOfferState('LOST');
        } else {
          setOfferState('PENDING');
          setError(outcome.error.message);
        }
      } else {
        setOfferState('UNKNOWN');
        setError('Network dropped while confirming with server. Reconciling assignment status…');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setError(null);
    setLoading(true);
    try {
      const outcome = await rejectOffer(activeOffer.offerId);
      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.back();
      } else if (outcome.outcome === 'REJECTED') {
        if (outcome.error.code === 'OFFER_UNAVAILABLE' || outcome.error.status === 409) {
          setOfferState('LOST');
        } else {
          setOfferState('PENDING');
          setError(outcome.error.message);
        }
      } else {
        setOfferState('UNKNOWN');
        setError('The rejection could not be confirmed. The offer remains pending until the server is reconciled.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExpired = () => {
    setOfferState('EXPIRED');
    rejectOffer(activeOffer.offerId).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container}>
      {!isNetworkConnected ? <OfflineBanner /> : null}

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>New Delivery Request</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Confirming assignment with server…' : 'Review details and accept within countdown'}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <DeliveryOfferCard
          loading={loading}
          offer={activeOffer}
          onAccept={handleAccept}
          onExpired={handleExpired}
          onReject={handleReject}
        />
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
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  headerSub: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDesc: {
    ...typography.body,
    color: palette.inkMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  backBtn: {
    minWidth: 180,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: palette.error,
  },
  errorText: {
    ...typography.bodySmall,
    color: palette.error,
    textAlign: 'center',
    fontWeight: '600',
  },
});