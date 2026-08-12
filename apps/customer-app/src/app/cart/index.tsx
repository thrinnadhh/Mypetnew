import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCart } from '@/context/CartContext';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export default function CartScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { items, providerName, subtotalAmount, updateQuantity, removeFromCart, clearCart, revalidateCart } = useCart();

  const deliveryFee = subtotalAmount > 0 ? 49 : 0;
  const grandTotal = subtotalAmount + deliveryFee;

  const handleCheckoutProceed = () => {
    const isValid = revalidateCart();
    if (!isValid) {
      alert('Some items in your cart were modified due to stock updates. Please review your cart.');
      return;
    }
    router.push('/checkout' as never);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="My Cart"
        subtitle={providerName ? `Ordering from ${providerName}` : 'Your selected pet items'}
        trailing={
          items.length > 0 ? (
            <Pressable onPress={() => void clearCart()} style={{ padding: 4 }}>
              <ThemedText style={{ color: theme.danger, fontWeight: '700', fontSize: 13 }}>Clear Cart</ThemedText>
            </Pressable>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <AppIcon name="store" color={theme.textSecondary} size={48} />
          <ThemedText style={styles.emptyTitle}>Your Cart is Empty</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center' }}>
            Browse our categories or pet superstores to add food, toys, and supplies.
          </ThemedText>
          <PrimaryButton label="Start Shopping" onPress={() => router.push('/category/food' as never)} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.product.id}-${item.selectedVariant?.id ?? 'default'}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.cartItemCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <Image source={{ uri: item.product.imageUrl }} style={styles.itemImage} resizeMode="cover" />

                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>{item.product.brand}</ThemedText>
                  <ThemedText style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
                    {item.product.name}
                  </ThemedText>
                  {item.selectedVariant && (
                    <StatusBadge label={item.selectedVariant.name} color={theme.primary} />
                  )}
                  <ThemedText style={{ fontWeight: '800', fontSize: 15, color: theme.primary }}>
                    ₹{item.unitPrice * item.quantity}
                  </ThemedText>
                </View>

                <View style={styles.actionCol}>
                  <Pressable
                    onPress={() => removeFromCart(item.product.id, item.selectedVariant?.id)}
                    style={{ alignSelf: 'flex-end', padding: 4 }}
                  >
                    <AppIcon name="warning" color={theme.textSecondary} size={16} />
                  </Pressable>

                  <View style={[styles.stepper, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
                    <Pressable
                      onPress={() => updateQuantity(item.product.id, item.selectedVariant?.id, item.quantity - 1)}
                      style={styles.stepBtn}
                    >
                      <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>-</ThemedText>
                    </Pressable>
                    <ThemedText style={{ color: theme.primary, fontWeight: '700', paddingHorizontal: 6 }}>{item.quantity}</ThemedText>
                    <Pressable
                      onPress={() => updateQuantity(item.product.id, item.selectedVariant?.id, item.quantity + 1)}
                      style={styles.stepBtn}
                    >
                      <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>+</ThemedText>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          />

          {/* Price Breakdown Footer */}
          <View style={[styles.checkoutBox, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>

            <View style={styles.summaryRow}>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Items Subtotal</ThemedText>
              <ThemedText style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>₹{subtotalAmount}</ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Delivery Fee</ThemedText>
              <ThemedText style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>₹{deliveryFee}</ThemedText>
            </View>
            <View style={[styles.summaryRow, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderColor: theme.border }]}>
              <ThemedText style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>Total Amount</ThemedText>
              <ThemedText style={{ color: theme.primary, fontWeight: '900', fontSize: 18 }}>₹{grandTotal}</ThemedText>
            </View>

            <PrimaryButton label="Proceed to Checkout →" onPress={handleCheckoutProceed} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.x3 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.x6, gap: spacing.x3 },
  emptyTitle: { ...typography.headline, fontSize: 18, marginTop: 8 },
  listContent: { gap: spacing.x3, paddingBottom: 160 },
  cartItemCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.x3, borderRadius: radii.card, borderWidth: 1, gap: spacing.x3 },
  itemImage: { width: 64, height: 64, borderRadius: radii.compact },
  itemTitle: { ...typography.headline, fontSize: 14, fontWeight: '700' },
  actionCol: { justifyContent: 'space-between', alignItems: 'flex-end', height: 64 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: 4, height: 32 },
  stepBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  checkoutBox: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 1, padding: spacing.x4, gap: spacing.x2 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
