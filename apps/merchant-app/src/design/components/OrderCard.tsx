import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import {
  type MerchantOrderStatus,
  type MerchantOrderWorkItem,
} from '../../operations/orders';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { StatusBadge, type StatusVariant } from './StatusBadge';

export interface OrderCardProps {
  order: MerchantOrderWorkItem;
  availableTargets: MerchantOrderStatus[];
  onTransition: (order: MerchantOrderWorkItem, target: MerchantOrderStatus) => void;
  onViewDetails?: (order: MerchantOrderWorkItem) => void;
  busy?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function orderStatusVariant(status: MerchantOrderStatus): StatusVariant {
  switch (status) {
    case 'PLACED':
      return 'warning';
    case 'ACCEPTED':
      return 'info';
    case 'PREPARING':
      return 'syncing';
    case 'READY_FOR_PICKUP':
      return 'info';
    case 'PICKED_UP':
      return 'info';
    case 'DELIVERED':
      return 'success';
    case 'REJECTED':
    case 'CANCELLED':
      return 'error';
    default:
      return 'neutral';
  }
}

export function orderStatusLabel(status: MerchantOrderStatus): string {
  switch (status) {
    case 'PLACED':
      return 'New Order';
    case 'ACCEPTED':
      return 'Accepted';
    case 'PREPARING':
      return 'Preparing';
    case 'READY_FOR_PICKUP':
      return 'Ready for Pickup';
    case 'PICKED_UP':
      return 'Picked Up';
    case 'DELIVERED':
      return 'Delivered / Completed';
    case 'REJECTED':
      return 'Rejected';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return (status as string).replaceAll('_', ' ');
  }
}

export function actionButtonTitle(target: MerchantOrderStatus): string {
  switch (target) {
    case 'ACCEPTED':
      return 'Accept Order';
    case 'REJECTED':
      return 'Reject';
    case 'PREPARING':
      return 'Start Preparing';
    case 'READY_FOR_PICKUP':
      return 'Mark Ready';
    case 'PICKED_UP':
      return 'Mark Picked Up';
    case 'DELIVERED':
      return 'Complete Hand-off';
    case 'CANCELLED':
      return 'Cancel Order';
    default:
      return (target as string).replaceAll('_', ' ');
  }
}

export function OrderCard({
  order,
  availableTargets,
  onTransition,
  onViewDetails,
  busy = false,
  style,
  testID,
}: OrderCardProps) {
  const isHighPriority = order.status === 'PLACED';
  const isDelivery = order.fulfilmentMode === 'DELIVERY';

  const primaryAction = availableTargets.find(
    (t) => t !== 'REJECTED' && t !== 'CANCELLED'
  );
  const destructiveAction = availableTargets.find(
    (t) => t === 'REJECTED' || t === 'CANCELLED'
  );

  return (
    <View
      style={[
        styles.card,
        isHighPriority && styles.cardHighPriority,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Order ${order.orderNumber}, status ${orderStatusLabel(order.status)}, total ${formatPaise(order.grandTotalPaise)}`}
      testID={testID}
    >
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.orderIdBlock}>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          <Text style={styles.timestamp}>
            {new Date(order.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })}
          </Text>
        </View>

        <StatusBadge
          label={orderStatusLabel(order.status)}
          variant={orderStatusVariant(order.status)}
          testID={testID ? `${testID}-status-badge` : undefined}
        />
      </View>

      {/* Meta Row: Mode, Payment, Amount */}
      <View style={styles.metaRow}>
        <View style={styles.pillGroup}>
          <View
            style={[
              styles.modePill,
              isDelivery ? styles.modePillDelivery : styles.modePillPickup,
            ]}
          >
            <Text style={styles.modeIcon}>{isDelivery ? '🚚' : '🛍️'}</Text>
            <Text
              style={[
                styles.modeText,
                isDelivery ? styles.modeTextDelivery : styles.modeTextPickup,
              ]}
            >
              {isDelivery ? 'Delivery' : 'Store Pickup'}
            </Text>
          </View>

          <View style={styles.paymentPill}>
            <Text style={styles.paymentText}>
              {order.paymentStatus.replaceAll('_', ' ').toLowerCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.amountText}>{formatPaise(order.grandTotalPaise)}</Text>
      </View>

      {/* Action Bar */}
      <View style={styles.actionsRow}>
        {onViewDetails ? (
          <SecondaryButton
            title="Details"
            onPress={() => onViewDetails(order)}
            disabled={busy}
            style={styles.detailBtn}
            testID={testID ? `${testID}-details-btn` : undefined}
          />
        ) : null}

        {destructiveAction ? (
          <SecondaryButton
            title={actionButtonTitle(destructiveAction)}
            onPress={() => onTransition(order, destructiveAction)}
            disabled={busy}
            style={styles.destructiveBtn}
            testID={testID ? `${testID}-action-${destructiveAction}` : undefined}
          />
        ) : null}

        {primaryAction ? (
          <PrimaryButton
            title={actionButtonTitle(primaryAction)}
            onPress={() => onTransition(order, primaryAction)}
            loading={busy}
            disabled={busy}
            style={styles.primaryBtn}
            testID={testID ? `${testID}-action-${primaryAction}` : undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.cardPadding,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHighPriority: {
    borderColor: colors.warning,
    borderLeftWidth: 4,
    backgroundColor: '#fffdfa',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderIdBlock: {
    gap: 2,
  },
  orderNumber: {
    ...typography.headlineSm,
    color: colors.slate900,
    fontWeight: '800',
  },
  timestamp: {
    ...typography.bodySm,
    color: colors.slate500,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  pillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.base,
    borderRadius: radius.sm,
    gap: 4,
  },
  modePillPickup: {
    backgroundColor: '#eff6ff',
  },
  modePillDelivery: {
    backgroundColor: '#f5f3ff',
  },
  modeIcon: {
    fontSize: 12,
  },
  modeText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
  modeTextPickup: {
    color: '#1e40af',
  },
  modeTextDelivery: {
    color: '#6b21a8',
  },
  paymentPill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.base,
    borderRadius: radius.sm,
    backgroundColor: colors.slate100,
  },
  paymentText: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate700,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  amountText: {
    ...typography.labelLg,
    color: colors.slate900,
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  detailBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
  },
  destructiveBtn: {
    flex: 1.2,
    minHeight: spacing.touchTargetMin,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
  },
  primaryBtn: {
    flex: 2,
    minHeight: spacing.touchTargetMin,
  },
});
