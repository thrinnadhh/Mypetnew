import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddressCard } from '../../../components/AddressCard';
import { Button } from '../../../components/Button';
import { DeliveryTimeline } from '../../../components/DeliveryTimeline';
import { palette, radii, spacing, typography } from '../../../design/tokens';
import { useDeliveryStore } from '../../../state/delivery-store';

export default function PickupScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery } = useDeliveryStore();
  const [arrived, setArrived] = useState(false);

  const delivery = activeDelivery;
  if (!delivery) {
    router.replace('/(tabs)/home');
    return null;
  }

  const handleProceedToProof = () => {
    router.push(`/delivery/${jobId}/pickup-proof` as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Fixed Header */}
      <View style={styles.header}>
        <Text style={styles.headerSubtitle}>ACTIVE DELIVERY</Text>
        <Text style={styles.headerTitle}>{delivery.orderReference || `Order #${delivery.orderId.slice(0, 8)}`}</Text>
      </View>

      <DeliveryTimeline status={delivery.state} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Merchant Pickup Address Card */}
        <AddressCard
          address={`${delivery.outletName} Store`}
          instructions="Show order ID to store manager"
          latitude={delivery.originLatitude}
          longitude={delivery.originLongitude}
          name={delivery.outletName}
          title="STEP 1: PICKUP FROM STORE"
        />

        {/* Order Details Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardSectionTitle}>PACKAGE SUMMARY</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Items:</Text>
            <Text style={styles.detailVal}>{delivery.itemCount || 1} Items</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Order ID:</Text>
            <Text style={styles.detailVal}>{delivery.orderId}</Text>
          </View>
        </View>

        {/* Arrived Status / Next Action */}
        <View style={styles.bottomSection}>
          {!arrived ? (
            <Button
              onPress={() => setArrived(true)}
              style={styles.arrivedBtn}
              title="ARRIVED AT STORE"
              variant="secondary"
            />
          ) : (
            <View style={styles.arrivedBanner}>
              <Text style={styles.arrivedBannerText}>✓ Arrived at Store</Text>
            </View>
          )}

          <Button
            onPress={handleProceedToProof}
            style={styles.confirmBtn}
            title="VERIFY &amp; CONFIRM PICKUP"
            variant="primary"
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
  header: {
    backgroundColor: palette.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
  },
  headerSubtitle: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    fontWeight: '800',
  },
  headerTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 18,
    marginTop: 2,
  },
  content: {
    padding: spacing.lg,
  },
  detailsCard: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
    marginVertical: spacing.md,
  },
  cardSectionTitle: {
    ...typography.caption,
    color: palette.inkMuted,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    ...typography.body,
    color: palette.inkMuted,
  },
  detailVal: {
    ...typography.body,
    color: palette.ink,
    fontWeight: '700',
  },
  bottomSection: {
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  arrivedBtn: {
    minHeight: 52,
  },
  arrivedBanner: {
    backgroundColor: palette.emeraldSoft,
    padding: spacing.md,
    borderRadius: radii.compact,
    alignItems: 'center',
  },
  arrivedBannerText: {
    ...typography.label,
    color: '#065F46',
    fontWeight: '700',
  },
  confirmBtn: {
    minHeight: 56,
  },
});
