import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MerchantListing } from '../../catalog/api';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';
import { formatPaiseToRupees } from '../pos-cart';

export type ProductFoundCardProps = {
  listing: MerchantListing;
  availableStock: number;
  quantityInCart: number;
  onAddToCart: (listing: MerchantListing, availableStock: number) => void;
  onDismiss: () => void;
};

export function ProductFoundCard({
  listing,
  availableStock,
  quantityInCart,
  onAddToCart,
  onDismiss,
}: ProductFoundCardProps) {
  const isOutOfStock = availableStock <= 0;
  const isLowStock = availableStock > 0 && availableStock <= 3;

  return (
    <View style={styles.card} testID="product-found-card">
      <View style={styles.headerRow}>
        <View style={styles.nameContainer}>
          <Text style={styles.productName} numberOfLines={2}>
            {listing.name}
          </Text>
          <Text style={styles.barcodeText}>
            {listing.barcodeType} · {listing.normalizedBarcode}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss product card"
          onPress={onDismiss}
          style={styles.closeButton}
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.detailsRow}>
        <View style={styles.priceContainer}>
          <Text style={styles.sellingPrice}>
            {formatPaiseToRupees(listing.sellingPricePaise)}
          </Text>
          {listing.mrpPaise > listing.sellingPricePaise ? (
            <Text style={styles.mrpText}>
              MRP {formatPaiseToRupees(listing.mrpPaise)}
            </Text>
          ) : null}
        </View>

        <View style={styles.badgeContainer}>
          <View
            style={[
              styles.stockBadge,
              isOutOfStock
                ? styles.outOfStockBadge
                : isLowStock
                  ? styles.lowStockBadge
                  : styles.inStockBadge,
            ]}
          >
            <Text
              style={[
                styles.stockBadgeText,
                isOutOfStock
                  ? styles.outOfStockText
                  : isLowStock
                    ? styles.lowStockText
                    : styles.inStockText,
              ]}
            >
              {isOutOfStock
                ? 'Out of Stock'
                : isLowStock
                  ? `Low Stock (${availableStock})`
                  : `In Stock (${availableStock})`}
            </Text>
          </View>
          {quantityInCart > 0 ? (
            <View style={styles.inCartBadge}>
              <Text style={styles.inCartBadgeText}>In Cart: {quantityInCart}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            quantityInCart > 0 ? 'Add one more to cart' : 'Add to cart'
          }
          disabled={isOutOfStock}
          onPress={() => onAddToCart(listing, availableStock)}
          style={[
            styles.addButton,
            isOutOfStock ? styles.disabledButton : styles.activeAddButton,
          ]}
        >
          <Text style={styles.addButtonText}>
            {isOutOfStock
              ? 'Unavailable (No Stock)'
              : quantityInCart > 0
                ? '+1 More to Cart'
                : 'Add to Cart'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  nameContainer: {
    flex: 1,
    gap: 2,
  },
  productName: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  barcodeText: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  priceContainer: {
    gap: 2,
  },
  sellingPrice: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: '800',
  },
  mrpText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
    fontSize: 12,
  },
  badgeContainer: {
    alignItems: 'flex-end',
    gap: 4,
  },
  stockBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  inStockBadge: {
    backgroundColor: '#dcfce7',
  },
  inStockText: {
    ...typography.labelMd,
    color: '#15803d',
    fontWeight: '700',
  },
  lowStockBadge: {
    backgroundColor: '#fef3c7',
  },
  lowStockText: {
    ...typography.labelMd,
    color: '#b45309',
    fontWeight: '700',
  },
  outOfStockBadge: {
    backgroundColor: colors.errorContainer,
  },
  outOfStockText: {
    ...typography.labelMd,
    color: colors.error,
    fontWeight: '700',
  },
  stockBadgeText: {
    fontSize: 12,
  },
  inCartBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  inCartBadgeText: {
    ...typography.codeSm,
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
  },
  actionRow: {
    marginTop: spacing.xs,
  },
  addButton: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  activeAddButton: {
    backgroundColor: colors.primary,
  },
  disabledButton: {
    backgroundColor: colors.surfaceContainer,
  },
  addButtonText: {
    ...typography.labelLg,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
