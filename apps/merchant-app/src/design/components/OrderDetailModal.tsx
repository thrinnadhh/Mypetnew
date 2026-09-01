import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type MerchantOrderStatus,
  type MerchantOrderWorkItem,
} from '../../operations/orders';
import { colors, radius, spacing, typography } from '../tokens';
import { actionButtonTitle, formatPaise, orderStatusLabel, orderStatusVariant } from './OrderCard';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { StatusBadge } from './StatusBadge';

export interface OrderDetailModalProps {
  visible: boolean;
  order: MerchantOrderWorkItem | null;
  availableTargets: MerchantOrderStatus[];
  onClose: () => void;
  onTransition: (order: MerchantOrderWorkItem, target: MerchantOrderStatus) => void;
  busy?: boolean;
  testID?: string;
}

export function OrderDetailModal({
  visible,
  order,
  availableTargets,
  onClose,
  onTransition,
  busy = false,
  testID,
}: OrderDetailModalProps) {
  if (!order) return null;

  const isDelivery = order.fulfilmentMode === 'DELIVERY';
  const primaryAction = availableTargets.find(
    (t) => t !== 'REJECTED' && t !== 'CANCELLED'
  );
  const destructiveAction = availableTargets.find(
    (t) => t === 'REJECTED' || t === 'CANCELLED'
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.title}>{order.orderNumber}</Text>
              <Text style={styles.subtitle}>
                Placed on {new Date(order.createdAt).toLocaleString('en-IN')}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close order details"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Status & Fulfilment Banner */}
            <View style={styles.statusSection}>
              <View style={styles.statusRow}>
                <Text style={styles.sectionLabel}>Current Status</Text>
                <StatusBadge
                  label={orderStatusLabel(order.status)}
                  variant={orderStatusVariant(order.status)}
                />
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.sectionLabel}>Fulfilment Mode</Text>
                <View
                  style={[
                    styles.modePill,
                    isDelivery ? styles.modePillDelivery : styles.modePillPickup,
                  ]}
                >
                  <Text>{isDelivery ? '🚚 Delivery' : '🛍️ Store Pickup'}</Text>
                </View>
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.sectionLabel}>Payment Status</Text>
                <Text style={styles.paymentValue}>
                  {order.paymentStatus.replaceAll('_', ' ')}
                </Text>
              </View>
            </View>

            {/* Order Identifiers */}
            <View style={styles.detailsCard}>
              <Text style={styles.cardHeader}>Order Identifiers</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Order UUID</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {order.orderId}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Outlet ID</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {order.outletId}
                </Text>
              </View>
            </View>

            {/* Financial Summary */}
            <View style={styles.detailsCard}>
              <Text style={styles.cardHeader}>Payment Breakdown</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Grand Total (PAISE / 100)</Text>
                <Text style={styles.grandTotalValue}>
                  {formatPaise(order.grandTotalPaise)}
                </Text>
              </View>
              <Text style={styles.footnote}>
                Authorized by backend commerce settlement rules.
              </Text>
            </View>
          </ScrollView>

          {/* Action Bar */}
          {availableTargets.length > 0 ? (
            <View style={styles.footerActions}>
              {destructiveAction ? (
                <SecondaryButton
                  title={actionButtonTitle(destructiveAction)}
                  onPress={() => onTransition(order, destructiveAction)}
                  disabled={busy}
                  style={styles.destructiveBtn}
                />
              ) : null}
              {primaryAction ? (
                <PrimaryButton
                  title={actionButtonTitle(primaryAction)}
                  onPress={() => onTransition(order, primaryAction)}
                  loading={busy}
                  disabled={busy}
                  style={styles.primaryBtn}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.terminalFooter}>
              <Text style={styles.terminalText}>
                No further state transitions available for this order.
              </Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  headerTitleGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate500,
  },
  closeBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeText: {
    fontSize: 18,
    color: colors.slate600,
    fontWeight: '700',
  },
  scrollBody: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusSection: {
    backgroundColor: colors.surfaceDim,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    ...typography.labelMd,
    color: colors.slate700,
  },
  modePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.base,
    borderRadius: radius.sm,
  },
  modePillPickup: {
    backgroundColor: '#eff6ff',
  },
  modePillDelivery: {
    backgroundColor: '#f5f3ff',
  },
  paymentValue: {
    ...typography.labelMd,
    color: colors.slate900,
    textTransform: 'capitalize',
    fontWeight: '700',
  },
  detailsCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardHeader: {
    ...typography.labelMd,
    color: colors.slate900,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  metaLabel: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  metaValue: {
    ...typography.codeSm,
    color: colors.slate800,
    maxWidth: '60%',
  },
  grandTotalValue: {
    ...typography.headlineSm,
    color: colors.primary,
    fontWeight: '800',
  },
  footnote: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate500,
    marginTop: spacing.xs,
  },
  footerActions: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  destructiveBtn: {
    flex: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
  },
  primaryBtn: {
    flex: 2,
  },
  terminalFooter: {
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.slate50,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  terminalText: {
    ...typography.bodySm,
    color: colors.slate500,
  },
});
