import { StyleSheet, Text, View } from 'react-native'
import { InfoCard, Page, PrimaryButton, formatPaise } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function CheckoutScreen() {
  const subtotal = 165000
  const platformFee = 1000
  const total = subtotal + platformFee
  return (
    <Page bottomNav={false} showBack title="Checkout">
      <InfoCard title="Order Summary">
        <Line label="Premium Adult Dog Food (2kg)" value="₹1,250" sub="Qty: 1" />
        <Line label="Interactive Rope Toy" value="₹400" sub="Qty: 2" />
        <View style={styles.divider} />
        <Total label="Subtotal" value={formatPaise(subtotal)} />
        <Total label="Platform fee" value="₹10" />
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total Amount</Text><Text style={styles.totalValue}>{formatPaise(total)}</Text></View>
      </InfoCard>

      <InfoCard title="Pickup Details"><View style={styles.address}><Text style={styles.pin}>⌖</Text><View style={styles.flex}><Text style={styles.addressTitle}>The Posh Paws</Text><Text style={text.muted}>Tirupati · Pickup after merchant marks order ready</Text></View><Text style={styles.change}>Change</Text></View></InfoCard>

      <InfoCard title="Payment Method"><View style={styles.payment}><View style={styles.radioActive} /><View style={styles.flex}><Text style={styles.addressTitle}>Pay on fulfilment</Text><Text style={text.muted}>Sprint 1 supported payment mode</Text></View></View></InfoCard>

      <View style={styles.policy}><Text style={text.muted}>The frontend never invents online-payment success. Cashfree/online payment remains outside the active Sprint 1 scope.</Text></View>

      <View style={styles.sticky}><View><Text style={styles.totalValue}>{formatPaise(total)}</Text><Text style={text.tiny}>View detailed bill</Text></View><View style={styles.cta}><PrimaryButton label={`Place pickup order · ${formatPaise(total)}`} /></View></View>
    </Page>
  )
}
function Line({ label, value, sub }: { label: string; value: string; sub: string }) { return <View style={styles.row}><View style={styles.flex}><Text style={styles.item}>{label}</Text><Text style={text.tiny}>{sub}</Text></View><Text style={styles.amount}>{value}</Text></View> }
function Total({ label, value }: { label: string; value: string }) { return <View style={styles.totalLine}><Text style={text.muted}>{label}</Text><Text style={text.body}>{value}</Text></View> }
const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, paddingVertical: 4 },
  flex: { flex: 1 },
  item: { color: palette.text, fontSize: 13, fontWeight: '800' },
  amount: { color: palette.text, fontSize: 13, fontWeight: '900' },
  divider: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth },
  totalLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  totalLabel: { color: palette.primary, fontSize: 15, fontWeight: '900' },
  totalValue: { color: palette.primary, fontSize: 17, fontWeight: '900' },
  address: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  pin: { color: palette.primary, fontSize: 22 },
  addressTitle: { color: palette.text, fontSize: 13, fontWeight: '900' },
  change: { color: palette.primary, fontSize: 12, fontWeight: '800' },
  payment: { alignItems: 'center', borderColor: palette.primary, borderRadius: metrics.radiusSm, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  radioActive: { backgroundColor: palette.primary, borderColor: palette.primarySoft, borderRadius: 10, borderWidth: 4, height: 20, width: 20 },
  policy: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusMd, padding: 14 },
  sticky: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  cta: { flex: 1 }
})
