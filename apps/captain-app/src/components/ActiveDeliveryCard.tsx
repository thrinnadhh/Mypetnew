import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';
import { CaptainActiveDelivery } from '../features/delivery/types';
import { Button } from './Button';
import { DeliveryTimeline } from './DeliveryTimeline';
import { StatusBadge } from './StatusBadge';

export interface ActiveDeliveryCardProps {
  delivery: CaptainActiveDelivery;
  onContinue: () => void;
}

export const ActiveDeliveryCard: React.FC<ActiveDeliveryCardProps> = ({
  delivery,
  onContinue,
}) => {
  const isPickup = delivery.dispatchStatus === 'ASSIGNED';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ACTIVE DELIVERY</Text>
          <Text style={styles.orderRef}>{delivery.orderReference}</Text>
        </View>
        <StatusBadge
          label={isPickup ? 'PICKUP PENDING' : 'OUT FOR DELIVERY'}
          variant={isPickup ? 'assigned' : 'pickedUp'}
        />
      </View>

      <DeliveryTimeline status={delivery.dispatchStatus} />

      <View style={styles.infoSection}>
        <Text style={styles.infoLabel}>
          {isPickup ? 'PICKUP LOCATION' : 'DELIVER TO'}
        </Text>
        <Text style={styles.targetName}>
          {isPickup ? delivery.merchant?.name : delivery.customer?.name}
        </Text>
        <Text numberOfLines={2} style={styles.address}>
          {isPickup ? delivery.merchant?.address : delivery.customer?.address}
        </Text>
      </View>

      <Button
        onPress={onContinue}
        style={styles.continueBtn}
        title="Continue Delivery"
        variant="primary"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: palette.royalBlue,
    padding: spacing.lg,
    marginVertical: spacing.md,
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  orderRef: {
    ...typography.title,
    color: palette.ink,
    fontSize: 18,
  },
  infoSection: {
    backgroundColor: palette.coolWhite,
    padding: spacing.md,
    borderRadius: radii.compact,
    marginVertical: spacing.md,
  },
  infoLabel: {
    ...typography.caption,
    color: palette.inkMuted,
    marginBottom: 2,
  },
  targetName: {
    ...typography.label,
    color: palette.ink,
    fontSize: 14,
  },
  address: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
  },
  continueBtn: {
    marginTop: spacing.xs,
  },
});
