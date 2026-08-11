import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { previewProducts } from '../src/designData'
import { Chip, Page, ProductGrid, SearchBox, SectionHeader } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

const filters = ['All', 'Dry Food', 'Wet Food', 'Puppy', 'Adult'] as const

export default function CatalogScreen() {
  const [active, setActive] = useState<(typeof filters)[number]>('All')
  const [query, setQuery] = useState('')
  const products = useMemo(() => previewProducts.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [query])

  return (
    <Page title="Food & Nutrition">
      <SearchBox onChangeText={setQuery} placeholder="Search food, treats, brands..." value={query} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {filters.map((filter) => <Pressable key={filter} onPress={() => setActive(filter)}><Chip active={active === filter} label={filter} /></Pressable>)}
      </ScrollView>
      <View style={styles.row}><Text style={text.muted}>{products.length} products</Text><View style={styles.rowActions}><Text style={styles.action}>↕ Sort</Text><Text style={styles.action}>☷ Filters</Text></View></View>
      <View style={styles.section}><SectionHeader title="Trending nutrition" /><ProductGrid products={products} /></View>
      <View style={styles.note}><Text style={styles.noteTitle}>Medicine stays view-only</Text><Text style={text.muted}>The same catalog card supports view-only items without exposing an Add button.</Text></View>
    </Page>
  )
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingRight: metrics.pageGutter },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  rowActions: { flexDirection: 'row', gap: 16 },
  action: { color: palette.text, fontSize: 12, fontWeight: '800' },
  section: { gap: 14 },
  note: { backgroundColor: palette.surfaceSoft, borderRadius: metrics.radiusMd, gap: 4, padding: 14 },
  noteTitle: { color: palette.primary, fontSize: 13, fontWeight: '800' }
})
