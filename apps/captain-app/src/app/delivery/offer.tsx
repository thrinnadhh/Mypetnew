import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { DeliveryOfferCard } from '../../components/DeliveryOfferCard';
import { palette, spacing, typography } from '../../design/tokens';
import { useDeliveryStore } from '../../state/delivery-store';

export default function DeliveryOfferModal() {
  const { activeOffer, acceptOffer, rejectOffer } = useDeliveryStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!activeOffer) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContent}>
          <Text style={styles.emptyTitle}>No active offer</Text>
          <Text style={styles.emptyDesc}>This delivery offer may have already expired or been accepted.</Text>
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
    try {
      const outcome = await acceptOffer(activeOffer.offerId);
      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.replace(`/delivery/${outcome.data.jobId}` as any);
      } else if (outcome.outcome === 'REJECTED') {
        setError(outcome.error.message);
      } else {
        setError('Network error while accepting offer. Reconciling with server…');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await rejectOffer(activeOffer.offerId);
      router.back();
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>New Delivery Request</Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <DeliveryOfferCard
          loading={loading}
          offer={activeOffer}
          onAccept={handleAccept}
          onExpired={() => {
            rejectOffer(activeOffer.offerId);
            router.back();
          }}
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
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    marginBottom: 4,
  },
  emptyDesc: {
    ...typography.body,
    color: palette.inkMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  backBtn: {
    minWidth: 180,
  },
  errorText: {
    ...typography.bodySmall,
    color: palette.error,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
