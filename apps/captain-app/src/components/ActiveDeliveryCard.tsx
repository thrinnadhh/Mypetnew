import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';
import { DeliveryJob } from '../domain/delivery';
import { Button } from './Button';
import { DeliveryTimeline } from './DeliveryTimeline';
import { StatusBadge } from './StatusBadge';

export interface ActiveDeliveryCardProps {
  delivery: DeliveryJob;
  onContinue: () => void;
}

export const ActiveDeliveryCard: React.FC<ActiveDeliveryCardProps> = ({
  delivery,
  onContinue,
}) => {
  const isPickup = delivery.state === 'ASSIGNED' || delivery.state === 'ARRIVING_PICKUP' || delivery.state === 'PICKUP_CONFIRMING';
  const isUnknown = delivery.state === 'UNKNOWN';

  let statusLabel = isPickup ? 'PICKUP PENDING' : 'OUT FOR DELIVERY';
  let badgeVariant: 'assigned' | 'pickedUp' | 'warning' = isPickup ? 'assigned' : 'pickedUp';

  if (isUnknown) {
    statusLabel = 'CONFIRMATION PENDING';
    badgeVariant = 'warning';
  }

  const destinationName = isPickup ? delivery.outletName : delivery.deliveryAddress?.recipientName;
  const addressLine = isPickup
    ? `${delivery.outletName} Store`
    : `${delivery.deliveryAddress?.line1 || ''}, ${delivery.deliveryAddress?.city || ''}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ACTIVE DELIVERY</Text>
          <Text style={styles.orderRef}>{delivery.orderReference || `Order #${delivery.orderId.slice(0, 8)}`}</Text>
        </View>
        <StatusBadge
          label={statusLabel}
          variant={badgeVariant}
        />
      </View>

      <DeliveryTimeline status={delivery.state} />

      <View style={styles.infoSection}>
        <Text style={styles.infoLabel}>
          {isPickup ? 'PICKUP LOCATION' : 'DELIVER TO'}
        </Text>
        <Text style={styles.targetName}>{destinationName}</Text>
        <Text numberOfLines={2} style={styles.address}>
          {addressLine}
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
