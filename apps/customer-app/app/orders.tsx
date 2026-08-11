import { StyleSheet, Text, View } from 'react-native'
import { Badge, Chip, InfoCard, Page, PrimaryButton, SecondaryButton } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

const orders = [
  { merchant: 'Happy Tails Vet & Shop', id: 'MPT-9824', status: 'In progress', total: '₹459', detail: 'Pickup today · 2:30 PM – 3:00 PM', action: 'Track order', tone: 'amber' as const },
  { merchant: 'Urban Pet Pantry', id: 'MPT-7712', status: 'Delivered', total: '₹1,120', detail: 'Delivered · Oct 12, 2026', action: 'Reorder', tone: 'green' as const },
  { merchant: 'Paw Spa & Boutique', id: 'MPT-6501', status: 'Cancelled', total: '₹850', detail: 'Cancelled · Sep 28, 2026', action: 'View details', tone: 'red' as const }
]

export default function OrdersScreen() {
  return (
    <Page title="Order History">
      <View style={styles.filters}><Chip active label="All Orders" /><Chip label="Active" /><Chip label="Past 30 Days" /></View>
      {orders.map((order, index) => <InfoCard key={order.id}>
        <View style={styles.top}><View style={styles.flex}><Text style={styles.merchant}>{order.merchant}</Text><Text style={text.tiny}>Order #{order.id}</Text></View><Badge label={order.status} tone={order.tone} /></View>
        <View style={styles.divider} />
        <View style={styles.row}><View style={styles.flex}><Text style={text.tiny}>Status</Text><Text style={text.body}>{order.detail}</Text></View><View style={styles.amount}><Text style={text.tiny}>Total Amount</Text><Text style={styles.total}>{order.total}</Text></View></View>
        {index === 0 ? <PrimaryButton compact label={order.action} /> : <SecondaryButton label={order.action} />}
      </InfoCard>)}
      <View style={styles.note}><Text style={text.muted}>Order cards are sized for one-handed mobile use: primary actions remain at least 48dp and status is never represented by colour alone.</Text></View>
    </Page>
  )
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  top: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  merchant: { color: palette.text, fontSize: 15, fontWeight: '900' },
  divider: { backgroundColor: palette.border, height: StyleSheet.hairlineWidth },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  amount: { alignItems: 'flex-end' },
  total: { color: palette.text, fontSize: 15, fontWeight: '900' },
  note: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusMd, padding: 14 }
})
