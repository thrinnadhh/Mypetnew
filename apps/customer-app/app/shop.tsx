import { Link } from 'expo-router'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { images, previewProducts } from '../src/designData'
import { Badge, Chip, InfoCard, Page, ProductGrid, SectionHeader } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function ShopScreen() {
  return (
    <Page showBack title="The Posh Paws">
      <View style={styles.heroCard}>
        <Image source={{ uri: images.shop }} style={styles.heroImage} />
        <View style={styles.storeContent}>
          <View style={styles.titleRow}><View style={styles.flex}><Text style={text.title}>The Posh Paws</Text><Text style={text.muted}>Premium Pet Supplies & Accessories</Text></View><Text style={styles.heart}>♡</Text></View>
          <View style={styles.meta}><Badge label="★ 4.8" tone="green" /><Text style={text.muted}>◷ 20–30 mins</Text><Text style={text.muted}>◉ 1.2 km</Text></View>
        </View>
      </View>

      <InfoCard title="Loyalty Rewards">
        <View style={styles.loyaltyRow}><Text style={styles.stars}>★★★☆☆☆☆☆☆☆</Text><Text style={text.muted}>3/10 Stars to your next reward</Text></View>
      </InfoCard>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><Chip active label="All" /><Chip label="Dry Food" /><Chip label="Wet Food" /><Chip label="Treats" /></ScrollView>

      <View style={styles.section}><SectionHeader title="Trending highlights" /><ProductGrid products={previewProducts} /></View>

      <InfoCard title="Store information">
        <View style={styles.infoRow}><Text style={styles.infoKey}>Opening hours</Text><Text style={styles.open}>Open until 8:00 PM</Text></View>
        <View style={styles.infoRow}><Text style={text.muted}>Mon–Fri</Text><Text style={text.body}>9:00 AM – 8:00 PM</Text></View>
        <View style={styles.infoRow}><Text style={text.muted}>Saturday</Text><Text style={text.body}>10:00 AM – 6:00 PM</Text></View>
      </InfoCard>

      <Link href="/catalog" asChild><Pressable style={styles.fullButton}><Text style={styles.fullButtonText}>Browse all products</Text></Pressable></Link>
    </Page>
  )
}

const styles = StyleSheet.create({
  heroCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, overflow: 'hidden' },
  heroImage: { height: 190, width: '100%' },
  storeContent: { gap: 12, padding: 16 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  flex: { flex: 1, gap: 3 },
  heart: { color: palette.primary, fontSize: 27 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  loyaltyRow: { gap: 8 },
  stars: { color: palette.amber, fontSize: 21, letterSpacing: 3 },
  chips: { gap: 8 },
  section: { gap: 14 },
  infoRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  infoKey: { color: palette.text, fontSize: 13, fontWeight: '800' },
  open: { color: palette.success, fontSize: 13, fontWeight: '800' },
  fullButton: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', minHeight: 50 },
  fullButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }
})
