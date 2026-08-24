import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AddressCard } from '../../../components/AddressCard';
import { Button } from '../../../components/Button';
import { DeliveryTimeline } from '../../../components/DeliveryTimeline';
import { palette, radii, spacing, typography } from '../../../design/tokens';
import { useDeliveryStore } from '../../../state/delivery-store';
import { isUuid } from '../../../utils/uuid';

export default function CustomerDeliveryScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery } = useDeliveryStore();
  const [arrived, setArrived] = useState(false);

  const delivery = activeDelivery;

  // Authorization Security Guard: Never disclose customer details if unassigned or job mismatch
  if (!isUuid(jobId) || !delivery || delivery.jobId !== jobId || !delivery.deliveryAddress) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.unauthorizedContent}>
          <Text style={styles.unauthorizedIcon}>🔒</Text>
          <Text style={styles.unauthorizedTitle}>Customer Details Protected</Text>
          <Text style={styles.unauthorizedDesc}>
            Customer address and contact information are only disclosed after authoritative server confirmation of your assignment.
          </Text>
          <Button
            onPress={() => router.replace('/(tabs)/home')}
            style={styles.backBtn}
            title="Return to Dashboard"
            variant="primary"
          />
        </View>
      </SafeAreaView>
    );
  }

  const handleProceedToProof = () => {
    router.push(`/delivery/${jobId}/delivery-proof` as any);
  };

  const addressLine = [
    delivery.deliveryAddress.line1,
    delivery.deliveryAddress.line2,
    delivery.deliveryAddress.city,
    delivery.deliveryAddress.state,
    delivery.deliveryAddress.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Fixed Header */}
      <View style={styles.header}>
        <Text style={styles.headerSubtitle}>OUT FOR DELIVERY</Text>
        <Text style={styles.headerTitle}>{delivery.orderReference || `Order #${delivery.orderId.slice(0, 8)}`}</Text>
      </View>

      <DeliveryTimeline status={delivery.state} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Customer Address Card */}
        <AddressCard
          address={addressLine}
          instructions="Contact customer upon arrival"
          name={delivery.deliveryAddress.recipientName}
          phone={delivery.deliveryAddress.phoneNumber}
          title="STEP 2: DELIVER TO CUSTOMER"
        />

        {/* Order Details Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardSectionTitle}>ORDER DETAILS</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Reference:</Text>
            <Text style={styles.detailVal}>{delivery.orderReference || `#${delivery.orderId.slice(0, 8)}`}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>From Store:</Text>
            <Text style={styles.detailVal}>{delivery.outletName}</Text>
          </View>
        </View>

        {/* Arrived Status / Next Action */}
        <View style={styles.bottomSection}>
          {!arrived ? (
            <Button
              onPress={() => setArrived(true)}
              style={styles.arrivedBtn}
              title="ARRIVED AT CUSTOMER"
              variant="secondary"
            />
          ) : (
            <View style={styles.arrivedBanner}>
              <Text style={styles.arrivedBannerText}>✓ Arrived at Customer Location</Text>
            </View>
          )}

          <Button
            onPress={handleProceedToProof}
            style={styles.confirmBtn}
            title="VERIFY &amp; CONFIRM DELIVERY"
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
  unauthorizedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  unauthorizedIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  unauthorizedTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  unauthorizedDesc: {
    ...typography.body,
    color: palette.inkMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  backBtn: {
    minWidth: 200,
  },
});
