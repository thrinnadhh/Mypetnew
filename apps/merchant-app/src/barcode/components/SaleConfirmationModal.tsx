import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';
import { formatPaiseToRupees, type PosCart } from '../pos-cart';

export type SaleConfirmationModalProps = {
  visible: boolean;
  cart: PosCart;
  outletLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  error?: string | null;
};

export function SaleConfirmationModal({
  visible,
  cart,
  outletLabel,
  onConfirm,
  onCancel,
  submitting,
  error,
}: SaleConfirmationModalProps) {
  const isCustomerAssigned = !cart.customer.isWalkIn && Boolean(cart.customer.mobile);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={submitting ? () => {} : onCancel}
    >
      <View style={styles.overlay} testID="sale-confirmation-modal">
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Confirm POS Sale</Text>
          {outletLabel ? <Text style={styles.outletText}>Outlet: {outletLabel}</Text> : null}

          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {/* Customer & Payment Info */}
            <View style={styles.metaBox}>
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
                <Text style={styles.metaValue}>{cart.paymentDeclaration}</Text>
              </View>
              {isCustomerAssigned ? (
                <View style={styles.loyaltyNotice}>
                  <Text style={styles.loyaltyNoticeText}>
                    ⭐ 1 Loyalty Star will be awarded to customer
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Line Items List */}
            <View style={styles.linesSection}>
              <Text style={styles.linesTitle}>
                Items ({cart.totalQuantity} units)
              </Text>
              {cart.items.map((item) => (
                <View key={item.listingId} style={styles.lineRow}>
                  <View style={styles.lineInfo}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.lineSub}>
                      {item.quantity} × {formatPaiseToRupees(item.sellingPricePaise)}
                    </Text>
                  </View>
                  <Text style={styles.lineTotal}>
                    {formatPaiseToRupees(item.sellingPricePaise * item.quantity)}
                  </Text>
                </View>
              ))}
            </View>

            {/* Total */}
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>Grand Total</Text>
              <Text style={styles.totalAmount}>
                {formatPaiseToRupees(cart.totalPaise)}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText} accessibilityRole="alert">
                  {error}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actionFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Complete sale"
              disabled={submitting}
              onPress={onConfirm}
              style={[
                styles.button,
                styles.primaryButton,
                submitting ? styles.buttonDisabled : null,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Complete Sale</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to cart"
              disabled={submitting}
              onPress={onCancel}
              style={[styles.button, styles.secondaryButton]}
            >
              <Text style={styles.secondaryButtonText}>Back to Cart</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '85%',
    gap: spacing.sm,
  },
  sheetTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  outletText: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
  },
  scrollArea: {
    maxHeight: 380,
  },
  scrollContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  metaBox: {
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
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
  },
  metaValue: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: '700',
  },
  loyaltyNotice: {
    backgroundColor: '#dcfce7',
    borderRadius: radius.sm,
    padding: spacing.xs,
    marginTop: 4,
  },
  loyaltyNoticeText: {
    ...typography.codeSm,
    color: '#15803d',
    fontWeight: '700',
    fontSize: 11,
  },
  linesSection: {
    gap: spacing.xs,
  },
  linesTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: '700',
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  lineInfo: {
    flex: 1,
  },
  lineName: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  lineSub: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
    fontSize: 11,
  },
  lineTotal: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: '700',
  },
  totalBox: {
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
  errorBox: {
    backgroundColor: colors.errorContainer,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
    fontWeight: '600',
  },
  actionFooter: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  button: {
    minHeight: 52,
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
    fontWeight: '800',
    fontSize: 16,
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
  buttonDisabled: {
    backgroundColor: colors.surfaceContainer,
  },
});
