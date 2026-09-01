import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';
import {
  formatPaiseToRupees,
  isItemLowStock,
  isItemOutOfStock,
  validateCartForCheckout,
  type CustomerSummary,
  type PaymentDeclaration,
  type PosCart,
  type PosCartItem,
} from '../pos-cart';

export type PosCartViewProps = {
  cart: PosCart;
  isOnline: boolean;
  onUpdateQuantity: (listingId: string, quantity: number) => void;
  onRemoveItem: (listingId: string) => void;
  onClearCart: () => void;
  onSetPayment: (payment: PaymentDeclaration) => void;
  onSetCustomer: (customer: CustomerSummary) => void;
  onCheckoutPress: () => void;
  submitting?: boolean;
};

const PAYMENT_OPTIONS: Array<{ key: PaymentDeclaration; label: string }> = [
  { key: 'CASH', label: 'Cash' },
  { key: 'EXTERNAL_UPI', label: 'UPI' },
  { key: 'CARD_TERMINAL', label: 'Card' },
];

export function PosCartView({
  cart,
  isOnline,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onSetPayment,
  onSetCustomer,
  onCheckoutPress,
  submitting = false,
}: PosCartViewProps) {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [mobileInput, setMobileInput] = useState(cart.customer.mobile ?? '');

  const checkoutError = validateCartForCheckout(cart, isOnline);

  function handleSaveCustomer() {
    const trimmed = mobileInput.trim();
    if (trimmed.length === 0) {
      onSetCustomer({ id: null, isWalkIn: true });
    } else {
      onSetCustomer({
        id: null,
        mobile: trimmed,
        isWalkIn: false,
      });
    }
    setEditingCustomer(false);
  }

  function handleClearWithConfirm() {
    if (cart.items.length === 0) return;
    Alert.alert('Clear Cart', 'Are you sure you want to remove all items from the current POS cart?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onClearCart },
    ]);
  }

  return (
    <View style={styles.container} testID="pos-cart-view">
      {/* Customer Attribution */}
      <View style={styles.customerSection}>
        <View style={styles.customerHeader}>
          <Text style={styles.sectionLabel}>Customer Attribution</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editingCustomer ? 'Cancel customer edit' : 'Change customer'}
            onPress={() => setEditingCustomer(!editingCustomer)}
            style={styles.changeCustomerButton}
          >
            <Text style={styles.changeCustomerText}>
              {editingCustomer ? 'Cancel' : 'Change'}
            </Text>
          </Pressable>
        </View>

        {editingCustomer ? (
          <View style={styles.customerEditRow}>
            <TextInput
              value={mobileInput}
              onChangeText={setMobileInput}
              placeholder="Customer mobile (e.g. +919876543210)"
              keyboardType="phone-pad"
              autoCapitalize="none"
              accessibilityLabel="Customer mobile number"
              style={styles.customerInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save customer association"
              onPress={handleSaveCustomer}
              style={styles.saveCustomerButton}
            >
              <Text style={styles.saveCustomerButtonText}>Save</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.customerBadge}>
            <Text style={styles.customerBadgeText}>
              {cart.customer.isWalkIn
                ? '👤 Walk-in Customer (No loyalty account)'
                : `📱 ${cart.customer.mobile ?? 'Customer identified'} (+1 Star on checkout)`}
            </Text>
          </View>
        )}
      </View>

      {/* Cart Items List */}
      <View style={styles.itemsSection}>
        <View style={styles.itemsHeader}>
          <Text style={styles.sectionLabel}>
            Cart Items ({cart.totalQuantity} items)
          </Text>
          {cart.items.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all items from cart"
              onPress={handleClearWithConfirm}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonText}>Clear Cart</Text>
            </Pressable>
          ) : null}
        </View>

        {cart.items.length === 0 ? (
          <View style={styles.emptyCartBox}>
            <Text style={styles.emptyCartTitle}>POS Cart is Empty</Text>
            <Text style={styles.emptyCartBody}>
              Scan barcodes above or enter codes manually to add items to this sale.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.itemsList}
            contentContainerStyle={styles.itemsListContent}
            nestedScrollEnabled
          >
            {cart.items.map((item) => (
              <CartItemRow
                key={item.listingId}
                item={item}
                onUpdateQuantity={onUpdateQuantity}
                onRemoveItem={onRemoveItem}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Payment Selection */}
      <View style={styles.paymentSection}>
        <Text style={styles.sectionLabel}>Payment Declaration</Text>
        <View style={styles.paymentOptionsRow}>
          {PAYMENT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              accessibilityRole="button"
              accessibilityLabel={`Select payment method ${opt.label}`}
              onPress={() => onSetPayment(opt.key)}
              style={[
                styles.paymentChip,
                cart.paymentDeclaration === opt.key ? styles.paymentChipSelected : null,
              ]}
            >
              <Text
                style={[
                  styles.paymentChipText,
                  cart.paymentDeclaration === opt.key ? styles.paymentChipTextSelected : null,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Offline warning banner */}
      {!isOnline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            ⚡ Offline mode: Final checkout disabled until connection is restored.
          </Text>
        </View>
      ) : null}

      {/* Cart Summary & Checkout CTA */}
      <View style={styles.summaryFooter}>
        <View style={styles.totalRow}>
          <View>
            <Text style={styles.totalLabel}>Grand Total</Text>
            <Text style={styles.itemCountSubtext}>
              {cart.itemCount} SKU(s) · {cart.totalQuantity} unit(s)
            </Text>
          </View>
          <Text style={styles.totalAmount}>
            {formatPaiseToRupees(cart.totalPaise)}
          </Text>
        </View>

        {checkoutError && cart.items.length > 0 ? (
          <Text style={styles.errorNotice} accessibilityRole="alert">
            {checkoutError}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Proceed to complete sale"
          disabled={Boolean(checkoutError) || submitting}
          onPress={onCheckoutPress}
          style={[
            styles.checkoutButton,
            checkoutError || submitting
              ? styles.checkoutButtonDisabled
              : styles.checkoutButtonActive,
          ]}
        >
          <Text style={styles.checkoutButtonText}>
            {submitting ? 'Processing Sale…' : `Complete Sale (${cart.paymentDeclaration})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type CartItemRowProps = {
  item: PosCartItem;
  onUpdateQuantity: (listingId: string, quantity: number) => void;
  onRemoveItem: (listingId: string) => void;
};

function CartItemRow({ item, onUpdateQuantity, onRemoveItem }: CartItemRowProps) {
  const lineTotalPaise = item.sellingPricePaise * item.quantity;
  const isOutOfStock = isItemOutOfStock(item);
  const isLowStock = isItemLowStock(item);
  const isExceeded = item.quantity > item.availableStock;

  return (
    <View style={styles.itemCard} testID={`cart-item-${item.listingId}`}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemSubtext}>
          {item.barcodeType} · {formatPaiseToRupees(item.sellingPricePaise)} / unit
        </Text>

        {isExceeded ? (
          <Text style={styles.stockConflictText}>
            ⚠️ Only {item.availableStock} in stock (requested {item.quantity})
          </Text>
        ) : isLowStock ? (
          <Text style={styles.lowStockWarningText}>
            Low stock: {item.availableStock} remaining
          </Text>
        ) : isOutOfStock ? (
          <Text style={styles.stockConflictText}>⚠️ Out of stock</Text>
        ) : null}
      </View>

      <View style={styles.itemControls}>
        <Text style={styles.lineTotal}>{formatPaiseToRupees(lineTotalPaise)}</Text>

        <View style={styles.quantityControlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decrease quantity of ${item.name}`}
            onPress={() => onUpdateQuantity(item.listingId, item.quantity - 1)}
            style={styles.qtyButton}
          >
            <Text style={styles.qtyButtonText}>−</Text>
          </Pressable>

          <View style={styles.qtyDisplay}>
            <Text style={styles.qtyDisplayText}>{item.quantity}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Increase quantity of ${item.name}`}
            onPress={() => onUpdateQuantity(item.listingId, item.quantity + 1)}
            style={styles.qtyButton}
          >
            <Text style={styles.qtyButtonText}>+</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from cart`}
            onPress={() => onRemoveItem(item.listingId)}
            style={styles.removeButton}
          >
            <Text style={styles.removeButtonText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  customerSection: {
    gap: spacing.xs,
  },
  customerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: '700',
  },
  changeCustomerButton: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  changeCustomerText: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: '600',
  },
  customerBadge: {
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customerBadgeText: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  customerEditRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  customerInput: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  saveCustomerButton: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveCustomerButtonText: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  itemsSection: {
    gap: spacing.xs,
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearButton: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  clearButtonText: {
    ...typography.labelMd,
    color: colors.error,
    fontWeight: '600',
  },
  emptyCartBox: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyCartTitle: {
    ...typography.headlineMd,
    color: colors.onSurfaceVariant,
  },
  emptyCartBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  itemsList: {
    maxHeight: 280,
  },
  itemsListContent: {
    gap: spacing.xs,
  },
  itemCard: {
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  itemSubtext: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
    fontSize: 11,
  },
  stockConflictText: {
    ...typography.codeSm,
    color: colors.error,
    fontWeight: '700',
    fontSize: 11,
    marginTop: 2,
  },
  lowStockWarningText: {
    ...typography.codeSm,
    color: '#b45309',
    fontSize: 11,
    marginTop: 2,
  },
  itemControls: {
    alignItems: 'flex-end',
    gap: 4,
  },
  lineTotal: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: '700',
  },
  quantityControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  qtyButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
  },
  qtyDisplay: {
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyDisplayText: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: '700',
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  removeButtonText: {
    fontSize: 13,
    color: colors.error,
    fontWeight: '700',
  },
  paymentSection: {
    gap: spacing.xs,
  },
  paymentOptionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  paymentChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  paymentChipText: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  paymentChipTextSelected: {
    color: colors.primary,
    fontWeight: '800',
  },
  offlineBanner: {
    backgroundColor: '#fef3c7',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  offlineBannerText: {
    ...typography.bodyMd,
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryFooter: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  totalLabel: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  itemCountSubtext: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
    fontSize: 12,
  },
  totalAmount: {
    ...typography.headlineLg,
    color: colors.primary,
    fontWeight: '800',
  },
  errorNotice: {
    ...typography.bodyMd,
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
  checkoutButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  checkoutButtonActive: {
    backgroundColor: colors.primary,
  },
  checkoutButtonDisabled: {
    backgroundColor: colors.surfaceContainer,
  },
  checkoutButtonText: {
    ...typography.labelLg,
    color: colors.onPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
});
