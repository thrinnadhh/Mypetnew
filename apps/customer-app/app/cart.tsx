import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { InfoCard, Page, PrimaryButton } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function CartScreen() {
  return (
    <Page bottomNav={false} showBack title="Your Cart">
      <InfoCard tone="blue" title="One merchant per cart"><Text style={text.muted}>Items from different merchants never mix silently. Switching merchants requires an explicit confirmation.</Text></InfoCard>
      <View style={styles.empty}>
        <View style={styles.iconCircle}><Text style={styles.icon}>🛒</Text></View>
        <Text style={text.title}>Your cart is empty</Text>
        <Text style={styles.copy}>Browse nearby pet essentials and add products from one merchant at a time.</Text>
        <Link href="/catalog" asChild><Pressable style={styles.browse}><Text style={styles.browseText}>Browse products</Text></Pressable></Link>
      </View>
      <PrimaryButton disabled label="Continue to checkout" />
    </Page>
  )
}
const styles = StyleSheet.create({
  empty: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, gap: 12, paddingHorizontal: 24, paddingVertical: 36 },
  iconCircle: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderRadius: 42, height: 84, justifyContent: 'center', width: 84 },
  icon: { fontSize: 36 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  browse: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', minHeight: 48, paddingHorizontal: 20 },
  browseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }
})
