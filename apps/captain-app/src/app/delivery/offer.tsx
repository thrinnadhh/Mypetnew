import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { DeliveryOfferCard } from '../../components/DeliveryOfferCard';
import { palette, spacing, typography } from '../../design/tokens';
import { useDelivery } from '../../features/delivery/delivery-context';
import { getFriendlyErrorMessage } from '../../utils/errors';

export default function DeliveryOfferModal() {
  const { currentOffer, acceptOffer, rejectOffer, dismissOffer } = useDelivery();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!currentOffer) {
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
      const delivery = await acceptOffer(currentOffer.offerId);
      router.replace(`/delivery/${delivery.jobId}` as any);
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await rejectOffer(currentOffer.offerId);
      router.back();
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
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
          offer={currentOffer}
          onAccept={handleAccept}
          onExpired={() => {
            dismissOffer(currentOffer.offerId);
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
