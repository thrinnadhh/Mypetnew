import { Link, router } from 'expo-router'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useCart } from '../src/cartContext'
import { InfoCard, Page, PrimaryButton, SecondaryButton, formatPaise } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function CartScreen() {
  const { items, subtotalPaise, setQuantity, removeItem, clearCart } = useCart()

  if (items.length === 0) {
    return (
      <Page bottomNav={false} showBack title="Your Cart">
        <InfoCard tone="blue" title="One merchant per cart"><Text style={text.muted}>Items from different merchants never mix silently. Switching merchants always asks before replacing this cart.</Text></InfoCard>
        <View style={styles.empty}>
          <View style={styles.iconCircle}><Text style={styles.icon}>🛒</Text></View>
          <Text style={text.title}>Your cart is empty</Text>
          <Text style={styles.copy}>Browse nearby pet essentials and add products from one merchant at a time.</Text>
          <Link href="/catalog" asChild><Pressable accessibilityRole="button" style={styles.browse}><Text style={styles.browseText}>Browse products</Text></Pressable></Link>
        </View>
        <PrimaryButton disabled label="Continue to checkout" />
      </Page>
    )
  }

  const estimatedTotal = subtotalPaise + 1_000

  return (
    <Page bottomNav={false} showBack title="Your Cart">
      <InfoCard tone="blue" title="One merchant per cart"><Text style={text.muted}>Your final total is calculated by the server quote at checkout. This cart shows only the current item estimate plus the Sprint 1 ₹10 platform fee.</Text></InfoCard>

      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.listingId} style={styles.line}>
            {item.image !== undefined ? <Image source={{ uri: item.image }} style={styles.image} /> : <View style={styles.placeholder}><Text>🐾</Text></View>}
            <View style={styles.lineBody}>
              <Text numberOfLines={2} style={styles.name}>{item.name}</Text>
              <Text style={styles.price}>{formatPaise(item.pricePaise)}</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { removeItem(item.listingId) }}><Text style={styles.remove}>Remove</Text></Pressable>
            </View>
            <View style={styles.quantity}>
              <Pressable accessibilityLabel={`Decrease ${item.name}`} accessibilityRole="button" onPress={() => { setQuantity(item.listingId, item.quantity - 1) }} style={styles.quantityButton}><Text style={styles.quantityButtonText}>−</Text></Pressable>
              <Text accessibilityLabel={`Quantity ${String(item.quantity)}`} style={styles.quantityText}>{item.quantity}</Text>
              <Pressable accessibilityLabel={`Increase ${item.name}`} accessibilityRole="button" disabled={item.quantity >= 100} onPress={() => { setQuantity(item.listingId, item.quantity + 1) }} style={[styles.quantityButton, item.quantity >= 100 && styles.disabled]}><Text style={styles.quantityButtonText}>＋</Text></Pressable>
            </View>
          </View>
        ))}
      </View>

      <InfoCard title="Estimated bill">
        <BillLine label="Items" value={formatPaise(subtotalPaise)} />
        <BillLine label="Platform fee" value="₹10" />
        <View style={styles.divider} />
        <View style={styles.billLine}><Text style={styles.totalLabel}>Estimated total</Text><Text style={styles.totalValue}>{formatPaise(estimatedTotal)}</Text></View>
      </InfoCard>

      <PrimaryButton label="Continue to checkout" onPress={() => { router.push('/checkout') }} />
      <SecondaryButton label="Clear cart" onPress={clearCart} />
    </Page>
  )
}

function BillLine({ label, value }: { readonly label: string; readonly value: string }) {
  return <View style={styles.billLine}><Text style={text.muted}>{label}</Text><Text style={text.body}>{value}</Text></View>
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, gap: 12, paddingHorizontal: 24, paddingVertical: 36 },
  iconCircle: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderRadius: 42, height: 84, justifyContent: 'center', width: 84 },
  icon: { fontSize: 36 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  browse: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', minHeight: 48, paddingHorizontal: 20 },
  browseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  list: { gap: 10 },
  line: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 10 },
  image: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusSm, height: 72, width: 72 },
  placeholder: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusSm, height: 72, justifyContent: 'center', width: 72 },
  lineBody: { flex: 1, gap: 4 },
  name: { color: palette.text, fontSize: 13, fontWeight: '800', lineHeight: 17 },
  price: { color: palette.text, fontSize: 13, fontWeight: '900' },
  remove: { color: palette.danger, fontSize: 11, fontWeight: '800', paddingVertical: 4 },
  quantity: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  quantityButton: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderColor: palette.border, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  quantityButtonText: { color: palette.primary, fontSize: 20, fontWeight: '900' },
  quantityText: { color: palette.text, fontSize: 13, fontWeight: '900', minWidth: 24, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  billLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  divider: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth },
  totalLabel: { color: palette.primary, fontSize: 15, fontWeight: '900' },
  totalValue: { color: palette.primary, fontSize: 17, fontWeight: '900' }
})
