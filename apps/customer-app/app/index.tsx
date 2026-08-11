import { Link, router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { categories, images, previewProducts } from '../src/designData'
import { Badge, CategoryGrid, HomeHeader, Page, ProductGrid, SearchBox, SectionHeader, StoreCard } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

interface ListingSummary {
  readonly id: string
  readonly outletId: string
  readonly name: string
  readonly sellingPricePaise: number
  readonly currency: 'INR'
  readonly commerceMode: 'COMMERCE' | 'VIEW_ONLY'
}
interface ListingPage { readonly items: readonly ListingSummary[] }

export default function CustomerHome() {
  const [listings, setListings] = useState<readonly ListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/public/catalog?pageSize=8`)
      if (!response.ok) throw new Error('Catalog unavailable')
      const page = await response.json() as ListingPage
      setListings(page.items)
    } catch {
      setError('Nearby catalog is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const products = useMemo(() => listings.map((listing, index) => ({
    id: listing.id,
    name: listing.name,
    merchant: 'Nearby merchant',
    pricePaise: listing.sellingPricePaise,
    image: previewProducts[index % previewProducts.length]?.image,
    badge: index === 0 ? 'TRENDING' : undefined,
    viewOnly: listing.commerceMode === 'VIEW_ONLY'
  })), [listings])

  return (
    <Page bottomNav>
      <View style={styles.pullUp}><HomeHeader /></View>
      <SearchBox />

      <View style={styles.hero}>
        <Image resizeMode="cover" source={{ uri: images.hero }} style={StyleSheet.absoluteFillObject} />
        <View style={styles.heroOverlay}>
          <Badge label="NEW ARRIVALS" tone="green" />
          <Text style={styles.heroTitle}>Discover fresh essentials</Text>
          <Text style={styles.heroCopy}>Products, grooming and trusted care near you.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/catalog')} style={styles.heroButton}><Text style={styles.heroButtonText}>Explore</Text></Pressable>
        </View>
      </View>

      <View style={styles.quickRow}>
        <Link href="/catalog" asChild><Pressable style={styles.quickCard}><Text style={styles.quickIcon}>♡</Text><Text style={styles.quickLabel}>Favourites</Text></Pressable></Link>
        <Link href="/orders" asChild><Pressable style={styles.quickCard}><Text style={styles.quickIcon}>▣</Text><Text style={styles.quickLabel}>Orders</Text></Pressable></Link>
        <Link href="/reports" asChild><Pressable style={styles.quickCard}><Text style={styles.quickIcon}>✚</Text><Text style={styles.quickLabel}>Health</Text></Pressable></Link>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Shop by category" action="See all" />
        <CategoryGrid items={categories} onPress={() => router.push('/catalog')} />
      </View>

      <View style={styles.section}>
        <SectionHeader title="Trending for your pet" action="View all" />
        {loading ? <ActivityIndicator color={palette.primary} accessibilityLabel="Loading nearby products" /> : null}
        {error ? <Pressable onPress={() => { void load() }} style={styles.errorCard}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
        {!loading && !error && products.length > 0 ? <ProductGrid products={products} /> : null}
        {!loading && !error && products.length === 0 ? <View style={styles.previewNotice}><Text style={text.muted}>No live listings yet. Showing the approved frontend layout only.</Text></View> : null}
        {!loading && products.length === 0 ? <ProductGrid products={previewProducts} /> : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Premium shops nearby 🏆" action="Preview" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          <StoreCard image={images.shop} name="The Posh Paws" subtitle="Premium pet supplies & food" />
          <StoreCard image={previewProducts[0].image} name="Healthy Hounds" subtitle="Organic food & essentials" distance="2.1 km" />
        </ScrollView>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Care nearby" action="Design preview" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          <StoreCard href="/hospital" image={images.groom1} name="City Pet Hospital" subtitle="Emergency & general care" rating="4.9" />
          <StoreCard href="/grooming" image={images.groom2} name="Paws & Bubbles Spa" subtitle="Luxury grooming & styling" distance="0.8 km" />
        </ScrollView>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Pet guides" />
        <Link href="/guide" asChild><Pressable style={styles.guideCard}><View style={styles.guideCopy}><Badge label="PET GUIDE" tone="amber" /><Text style={text.section}>Puppy nutrition and healthy growth</Text><Text style={text.muted}>Practical care guidance in the same clean card system as your Stitch screens.</Text></View><Text style={styles.guideArrow}>›</Text></Pressable></Link>
      </View>
    </Page>
  )
}

const styles = StyleSheet.create({
  pullUp: { marginHorizontal: -metrics.pageGutter, marginTop: -12 },
  section: { gap: 14 },
  hero: { borderRadius: metrics.radiusLg, height: 190, overflow: 'hidden', position: 'relative' },
  heroOverlay: { backgroundColor: 'rgba(7, 19, 39, 0.56)', flex: 1, gap: 8, justifyContent: 'center', padding: 20 },
  heroTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', lineHeight: 30, maxWidth: 260 },
  heroCopy: { color: '#EEF4FF', fontSize: 13, lineHeight: 18, maxWidth: 260 },
  heroButton: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: 8, justifyContent: 'center', marginTop: 4, minHeight: 48, paddingHorizontal: 16, width: 104 },
  heroButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, flex: 1, gap: 5, justifyContent: 'center', minHeight: 78 },
  quickIcon: { color: palette.primary, fontSize: 22, fontWeight: '700' },
  quickLabel: { color: palette.text, fontSize: 11, fontWeight: '700' },
  horizontalList: { gap: 12, paddingRight: 4 },
  errorCard: { backgroundColor: palette.dangerSoft, borderRadius: metrics.radiusMd, padding: 14 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  previewNotice: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusMd, padding: 12 },
  guideCard: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 16 },
  guideCopy: { flex: 1, gap: 8 },
  guideArrow: { color: palette.primary, fontSize: 36, lineHeight: 38 }
})
