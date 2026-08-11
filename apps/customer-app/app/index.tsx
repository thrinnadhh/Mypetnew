import { Link } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { formatInrPaise } from '@mypet/api-contracts'
import { runtimeConfig } from '../src/runtime'
import { styles } from '../src/styles'

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
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/public/catalog?pageSize=20`)
      if (!response.ok) throw new Error('Catalog unavailable')
      const page = await response.json() as ListingPage
      setListings(page.items)
    } catch {
      setError('We could not load nearby pet products. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Pet care, close to home.</Text>
      <Text style={styles.subtitle}>Browse verified Tirupati merchants. Sign in only when you are ready to order.</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Link href="/otp" asChild><Pressable accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>Verify mobile</Text></Pressable></Link>
        <Link href="/cart" asChild><Pressable accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>Cart</Text></Pressable></Link>
      </View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading catalog" /> : null}
      {error ? <Pressable accessibilityRole="button" onPress={() => { void load() }}><Text style={styles.error}>{error} Tap to retry.</Text></Pressable> : null}
      {!loading && !error && listings.length === 0 ? <Text style={styles.status}>No active listings are available yet.</Text> : null}
      {listings.map((listing) => (
        <View accessibilityLabel={`${listing.name}, ${formatInrPaise(listing.sellingPricePaise)}`} key={listing.id} style={styles.card}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{listing.name}</Text>
          <Text>{formatInrPaise(listing.sellingPricePaise)}</Text>
          {listing.commerceMode === 'VIEW_ONLY' ? <Text style={styles.status}>Online purchase unavailable</Text> : null}
        </View>
      ))}
    </ScrollView>
  )
}

