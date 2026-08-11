import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { images } from '../src/designData'
import { Badge, Chip, InfoCard, Page, PrimaryButton, SectionHeader } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

type ServicePreview = { readonly name: string; readonly price: string; readonly duration: string; readonly image: string; readonly badge?: string }

const services: readonly ServicePreview[] = [
  { name: 'Luxury Bath & Dry', price: '₹1,200', duration: '60 mins', image: images.groom1, badge: 'Best Seller' },
  { name: 'Breed Specific Styling', price: '₹2,500', duration: '90 mins', image: images.groom2 },
  { name: 'Full Spa Package', price: '₹3,500', duration: '120 mins', image: images.groom1, badge: 'Sale' },
  { name: 'Medicated Tick Wash', price: '₹900', duration: '45 mins', image: images.groom2 }
] as const

export default function GroomingScreen() {
  const { width } = useWindowDimensions()
  const available = Math.min(width, metrics.contentMax) - (metrics.pageGutter * 2)
  const columns = width >= 700 ? 3 : 2
  const cardWidth = (available - 12 * (columns - 1)) / columns

  return (
    <Page showBack title="Grooming Services">
      <InfoCard tone="blue" title="Frontend preview"><Text style={text.muted}>Appointment booking is intentionally disabled while Sprint 1 is active. Preview controls below are non-interactive until the service API is introduced.</Text></InfoCard>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><Chip active label="All" /><Chip label="Bathing" /><Chip label="Haircut" /><Chip label="Spa" /></ScrollView>
      <View style={styles.topRow}><Text style={text.muted}>12 preview services</Text><Text style={styles.previewLabel}>Sort & filters · deferred</Text></View>
      <View style={styles.grid}>{services.map((service) => <View key={service.name} style={[styles.card, { width: cardWidth }]}><View style={styles.imageWrap}><Image source={{ uri: service.image }} style={styles.image} />{service.badge !== undefined ? <View style={styles.badge}><Badge label={service.badge} tone={service.badge === 'Sale' ? 'red' : 'amber'} /></View> : null}</View><View style={styles.body}><Text style={styles.name}>{service.name}</Text><Text style={text.tiny}>◷ {service.duration}</Text><Text style={styles.price}>{service.price}</Text><PrimaryButton compact disabled label="Booking deferred" /></View></View>)}</View>
      <View style={styles.section}><SectionHeader title="Paws & Bubbles Spa" /><InfoCard><Text style={text.body}>Luxury grooming tailored to your pet’s needs, with clear contact, hours, availability and service cards.</Text><View style={styles.infoRow}><Text style={text.muted}>Today</Text><Text style={styles.open}>Open until 7:00 PM</Text></View></InfoCard></View>
    </Page>
  )
}

const styles = StyleSheet.create({
  chips: { gap: 8 },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  previewLabel: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, overflow: 'hidden' },
  imageWrap: { aspectRatio: 1, backgroundColor: palette.surfaceSoft, position: 'relative' },
  image: { height: '100%', width: '100%' },
  badge: { left: 7, position: 'absolute', top: 7 },
  body: { gap: 6, padding: 10 },
  name: { color: palette.text, fontSize: 12, fontWeight: '800', minHeight: 32 },
  price: { color: palette.primary, fontSize: 16, fontWeight: '900' },
  section: { gap: 12 },
  infoRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  open: { color: palette.success, fontSize: 13, fontWeight: '800' }
})
