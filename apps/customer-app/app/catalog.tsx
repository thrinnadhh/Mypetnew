import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { previewProducts } from '../src/designData'
import { runtimeConfig } from '../src/runtime'
import { Chip, Page, ProductGrid, SearchBox, SectionHeader } from '../src/ui'
import type { ProductViewModel } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

const filters = ['All', 'Dry Food', 'Wet Food', 'Puppy', 'Adult'] as const
type Filter = (typeof filters)[number]
type SortMode = 'recommended' | 'price-asc' | 'price-desc'

interface ListingSummary {
  readonly id: string
  readonly outletId: string
  readonly name: string
  readonly sellingPricePaise: number
  readonly currency: 'INR'
  readonly commerceMode: 'COMMERCE' | 'VIEW_ONLY'
}
interface ListingPage { readonly items: readonly ListingSummary[] }

export default function CatalogScreen() {
  const params = useLocalSearchParams<{ q?: string }>()
  const [active, setActive] = useState<Filter>('All')
  const [query, setQuery] = useState(params.q ?? '')
  const [listings, setListings] = useState<readonly ListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('recommended')
  const [showFilters, setShowFilters] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/public/catalog?pageSize=50`)
      if (!response.ok) throw new Error('Catalog unavailable')
      const page = await response.json() as ListingPage
      setListings(page.items)
    } catch {
      setError('The live catalog is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (params.q !== undefined) setQuery(params.q) }, [params.q])

  const liveProducts = useMemo<readonly ProductViewModel[]>(() => listings.map((listing, index) => ({
    id: listing.id,
    outletId: listing.outletId,
    name: listing.name,
    merchant: 'Nearby merchant',
    pricePaise: listing.sellingPricePaise,
    image: previewProducts[index % previewProducts.length]?.image,
    viewOnly: listing.commerceMode === 'VIEW_ONLY'
  })), [listings])

  const sourceProducts: readonly ProductViewModel[] = liveProducts.length > 0 ? liveProducts : previewProducts
  const products = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = sourceProducts.filter((product) => {
      if (normalized.length > 0 && !product.name.toLowerCase().includes(normalized)) return false
      return matchesFilter(product.name, active)
    })
    if (sortMode === 'price-asc') return [...filtered].sort((a, b) => a.pricePaise - b.pricePaise)
    if (sortMode === 'price-desc') return [...filtered].sort((a, b) => b.pricePaise - a.pricePaise)
    return filtered
  }, [active, query, sortMode, sourceProducts])

  const cycleSort = () => {
    setSortMode((current) => current === 'recommended' ? 'price-asc' : current === 'price-asc' ? 'price-desc' : 'recommended')
  }

  const sortLabel = sortMode === 'recommended' ? 'Recommended' : sortMode === 'price-asc' ? 'Price ↑' : 'Price ↓'

  return (
    <Page title="Food & Nutrition">
      <SearchBox onChangeText={setQuery} placeholder="Search food, treats, brands..." value={query} />

      {showFilters ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {filters.map((filter) => (
            <Pressable accessibilityRole="button" hitSlop={4} key={filter} onPress={() => { setActive(filter) }}>
              <Chip active={active === filter} label={filter} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        <Text style={text.muted}>{products.length} products</Text>
        <View style={styles.rowActions}>
          <Pressable accessibilityRole="button" onPress={cycleSort} style={styles.actionButton}><Text style={styles.action}>↕ {sortLabel}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setShowFilters((visible) => !visible) }} style={styles.actionButton}><Text style={styles.action}>☷ Filters</Text></Pressable>
        </View>
      </View>

      {loading ? <ActivityIndicator accessibilityLabel="Loading catalog" color={palette.primary} /> : null}
      {error !== null ? <Pressable accessibilityRole="button" onPress={() => { void load() }} style={styles.error}><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && liveProducts.length === 0 ? <View style={styles.note}><Text style={styles.noteTitle}>Preview mode</Text><Text style={text.muted}>No live listings are available. Preview cards are visible for layout review but cannot be added to cart.</Text></View> : null}

      <View style={styles.section}><SectionHeader title="Products" /><ProductGrid products={products} /></View>
      <View style={styles.note}><Text style={styles.noteTitle}>Medicine stays view-only</Text><Text style={text.muted}>View-only catalog items never expose an Add button.</Text></View>
    </Page>
  )
}

function matchesFilter(name: string, filter: Filter): boolean {
  if (filter === 'All') return true
  const normalized = name.toLowerCase()
  if (filter === 'Dry Food') return normalized.includes('dry') || normalized.includes('kibble')
  if (filter === 'Wet Food') return normalized.includes('wet') || normalized.includes('gravy')
  if (filter === 'Puppy') return normalized.includes('puppy')
  return normalized.includes('adult')
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingRight: metrics.pageGutter },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  rowActions: { flexDirection: 'row', gap: 8 },
  actionButton: { alignItems: 'center', borderColor: palette.border, borderRadius: metrics.radiusSm, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 10 },
  action: { color: palette.text, fontSize: 11, fontWeight: '800' },
  section: { gap: 14 },
  note: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusMd, gap: 4, padding: 14 },
  noteTitle: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  error: { backgroundColor: palette.dangerSoft, borderRadius: metrics.radiusMd, minHeight: 48, padding: 14 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' }
})
