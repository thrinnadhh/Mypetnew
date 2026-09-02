import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';
import { formatPaiseToRupees, type PosCart } from '../pos-cart';
import type { PosSaleResponse } from '../api';

export type SaleReceiptModalProps = {
  visible: boolean;
  sale: PosSaleResponse | null;
  cart: PosCart;
  outletLabel?: string;
  onNewSale: () => void;
  onClose: () => void;
};

export function SaleReceiptModal({
  visible,
  sale,
  cart,
  outletLabel,
  onNewSale,
  onClose,
}: SaleReceiptModalProps) {
  if (!sale) return null;

  const formattedTime = new Date(sale.completedAt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay} testID="sale-receipt-modal">
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.successHeader}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkIcon}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Sale Completed</Text>
            <Text style={styles.saleRef}>
              Ref: POS-{sale.id.slice(0, 8).toUpperCase()}
            </Text>
          </View>

          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {/* Meta Information */}
            <View style={styles.receiptMeta}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Date & Time:</Text>
                <Text style={styles.metaValue}>{formattedTime}</Text>
              </View>
              {outletLabel ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Outlet:</Text>
                  <Text style={styles.metaValue}>{outletLabel}</Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Customer:</Text>
                <Text style={styles.metaValue}>
                  {cart.customer.isWalkIn
                    ? 'Walk-in'
                    : cart.customer.mobile ?? 'Associated'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Payment:</Text>
                <Text style={styles.metaValue}>PAID · {sale.paymentDeclaration}</Text>
              </View>
            </View>

            {/* Loyalty Attribution */}
            {sale.loyaltyAwarded ? (
              <View style={styles.loyaltyBadge}>
                <Text style={styles.loyaltyText}>
                  ⭐ 1 Loyalty Star awarded to customer
                </Text>
              </View>
            ) : null}

            {/* Purchased Items List */}
            <View style={styles.itemsSection}>
              <Text style={styles.itemsHeading}>Purchased Items</Text>
              {cart.items.map((item) => (
                <View key={item.listingId} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemQtyPrice}>
                      {item.quantity} × {formatPaiseToRupees(item.sellingPricePaise)}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>
                    {formatPaiseToRupees(item.sellingPricePaise * item.quantity)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Grand Total */}
            <View style={styles.totalSection}>
              <Text style={styles.totalLabel}>Total Paid</Text>
              <Text style={styles.totalAmount}>
                {formatPaiseToRupees(sale.totalPaise)}
              </Text>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actionFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new sale"
              onPress={onNewSale}
              style={[styles.button, styles.primaryButton]}
            >
              <Text style={styles.primaryButtonText}>Start New Sale</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close receipt"
              onPress={onClose}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  successHeader: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  checkCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: {
    fontSize: 24,
    color: '#15803d',
    fontWeight: '800',
  },
  successTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  saleRef: {
    ...typography.codeSm,
    color: colors.primary,
    fontWeight: '700',
  },
  scrollArea: {
    maxHeight: 340,
  },
  scrollContent: {
    gap: spacing.sm,
  },
  receiptMeta: {
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontSize: 12,
  },
  metaValue: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontSize: 12,
    fontWeight: '700',
  },
  loyaltyBadge: {
    backgroundColor: '#dcfce7',
    borderRadius: radius.sm,
    padding: spacing.xs,
    alignItems: 'center',
  },
  loyaltyText: {
    ...typography.codeSm,
    color: '#15803d',
    fontWeight: '700',
    fontSize: 11,
  },
  itemsSection: {
    gap: spacing.xs,
  },
  itemsHeading: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  itemQtyPrice: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
    fontSize: 11,
  },
  itemTotal: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: '700',
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 2,
    borderColor: colors.primary,
  },
  totalLabel: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  totalAmount: {
    ...typography.headlineLg,
    color: colors.primary,
    fontWeight: '800',
  },
  actionFooter: {
    gap: spacing.xs,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    ...typography.labelLg,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.surfaceDim,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...typography.labelMd,
    color: colors.onSurface,
  },
});
