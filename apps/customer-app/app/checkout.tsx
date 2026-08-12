import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useCart } from '../src/cartContext'
import { authenticatedFetch, CustomerAuthenticationRequiredError, loadCustomerSession } from '../src/session'
import { InfoCard, Page, PrimaryButton, SecondaryButton, formatPaise } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

interface QuoteResponse {
  readonly id: string
  readonly outletId: string
  readonly cartSignature: string
  readonly fulfilmentMode: 'STORE_PICKUP'
  readonly paymentMethod: 'PAY_ON_FULFILMENT'
  readonly pricing: {
    readonly itemSubtotalPaise: number
    readonly itemDiscountPaise: number
    readonly couponDiscountPaise: number
    readonly loyaltyRewardPaise: number
    readonly taxPaise: number
    readonly platformFeePaise: number
    readonly deliveryFeePaise: number
    readonly merchantCommissionPaise: number
    readonly grandTotalPaise: number
    readonly currency: 'INR'
  }
  readonly expiresAt: string
}

interface OrderResponse {
  readonly id: string
  readonly grandTotalPaise: number
  readonly paymentMethod: 'PAY_ON_FULFILMENT'
  readonly status: string
}

export default function CheckoutScreen() {
  const { items, outletId, clearCart } = useCart()
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [placedOrder, setPlacedOrder] = useState<OrderResponse | null>(null)

  const prepareQuote = useCallback(async () => {
    if (items.length === 0 || outletId === null) {
      setQuote(null)
      setQuoteError('Your cart is empty.')
      return
    }

    setLoadingQuote(true)
    setQuoteError(null)
    try {
      const session = await loadCustomerSession()
      if (session === null) {
        setNeedsAuth(true)
        setQuote(null)
        return
      }
      setNeedsAuth(false)
      const response = await authenticatedFetch('/api/v1/customer/quotes/pickup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outletId,
          lines: items.map((item) => ({ listingId: item.listingId, quantity: item.quantity }))
        })
      })
      if (!response.ok) throw new Error('Quote request failed')
      const body = await response.json() as QuoteResponse
      setQuote(body)
    } catch (error) {
      if (error instanceof CustomerAuthenticationRequiredError) {
        setNeedsAuth(true)
        setQuote(null)
      } else {
        setQuoteError('We could not confirm the live price or stock. Retry before placing the order.')
      }
    } finally {
      setLoadingQuote(false)
    }
  }, [items, outletId])

  useEffect(() => { void prepareQuote() }, [prepareQuote])

  const placeOrder = async () => {
    if (quote === null || placing) return
    setPlacing(true)
    setQuoteError(null)
    try {
      const response = await authenticatedFetch('/api/v1/customer/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `customer-order-${quote.id}`
        },
        body: JSON.stringify({ quoteId: quote.id, cartSignature: quote.cartSignature })
      })
      if (!response.ok) throw new Error('Checkout failed')
      const order = await response.json() as OrderResponse
      setPlacedOrder(order)
      clearCart()
    } catch (error) {
      if (error instanceof CustomerAuthenticationRequiredError) {
        setNeedsAuth(true)
      } else {
        setQuoteError('The order was not confirmed. Retry safely; the same quote uses the same idempotency key.')
      }
    } finally {
      setPlacing(false)
    }
  }

  if (placedOrder !== null) {
    return (
      <Page bottomNav={false} title="Order placed">
        <InfoCard tone="green" title="Pickup order confirmed">
          <Text style={styles.successTitle}>✓ {placedOrder.status}</Text>
          <Text style={text.body}>Order #{placedOrder.id}</Text>
          <Text style={text.muted}>Total: {formatPaise(placedOrder.grandTotalPaise)} · Pay on fulfilment</Text>
        </InfoCard>
        <PrimaryButton label="Back to home" onPress={() => { router.replace('/') }} />
        <SecondaryButton label="View orders" onPress={() => { router.replace('/orders') }} />
      </Page>
    )
  }

  return (
    <Page bottomNav={false} showBack title="Checkout">
      {needsAuth ? (
        <InfoCard tone="blue" title="Verify mobile to continue">
          <Text style={text.muted}>Checkout requires a verified customer session. Your cart stays in place while you verify.</Text>
          <PrimaryButton label="Verify mobile" onPress={() => { router.push({ pathname: '/otp', params: { returnTo: '/checkout' } }) }} />
        </InfoCard>
      ) : null}

      <InfoCard title="Order Summary">
        {items.map((item) => <Line key={item.listingId} label={item.name} value={formatPaise(item.pricePaise * item.quantity)} sub={`Qty: ${String(item.quantity)}`} />)}
        <View style={styles.divider} />
        {loadingQuote ? <ActivityIndicator accessibilityLabel="Confirming live price and stock" color={palette.primary} /> : null}
        {quote !== null ? (
          <>
            <Total label="Items" value={formatPaise(quote.pricing.itemSubtotalPaise)} />
            <Total label="Platform fee" value={formatPaise(quote.pricing.platformFeePaise)} />
            <Total label="Delivery fee" value={formatPaise(quote.pricing.deliveryFeePaise)} />
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Server-confirmed total</Text><Text style={styles.totalValue}>{formatPaise(quote.pricing.grandTotalPaise)}</Text></View>
            <Text style={text.tiny}>Quote expires at {new Date(quote.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
          </>
        ) : <Text style={text.muted}>A live server quote is required before the order button is enabled.</Text>}
      </InfoCard>

      <InfoCard title="Pickup Details"><View style={styles.address}><Text style={styles.pin}>⌖</Text><View style={styles.flex}><Text style={styles.addressTitle}>Store pickup</Text><Text style={text.muted}>Pickup after the merchant marks the order ready.</Text></View><Text style={styles.fixed}>Sprint 1</Text></View></InfoCard>
      <InfoCard title="Payment Method"><View style={styles.payment}><View style={styles.radioActive} /><View style={styles.flex}><Text style={styles.addressTitle}>Pay on fulfilment</Text><Text style={text.muted}>Server-authorized Sprint 1 payment mode</Text></View></View></InfoCard>

      {quoteError !== null ? <InfoCard tone="red"><Text style={styles.error}>{quoteError}</Text><SecondaryButton label="Retry live quote" onPress={() => { void prepareQuote() }} /></InfoCard> : null}

      <PrimaryButton disabled={quote === null || needsAuth || placing} label={placing ? 'Placing order…' : quote === null ? 'Waiting for live quote' : `Place pickup order · ${formatPaise(quote.pricing.grandTotalPaise)}`} onPress={() => { void placeOrder() }} />
    </Page>
  )
}

function Line({ label, value, sub }: { readonly label: string; readonly value: string; readonly sub: string }) {
  return <View style={styles.row}><View style={styles.flex}><Text style={styles.item}>{label}</Text><Text style={text.tiny}>{sub}</Text></View><Text style={styles.amount}>{value}</Text></View>
}
function Total({ label, value }: { readonly label: string; readonly value: string }) {
  return <View style={styles.totalLine}><Text style={text.muted}>{label}</Text><Text style={text.body}>{value}</Text></View>
}

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
  fixed: { color: palette.muted, fontSize: 11, fontWeight: '800' },
  payment: { alignItems: 'center', borderColor: palette.primary, borderRadius: metrics.radiusSm, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  radioActive: { backgroundColor: palette.primary, borderColor: palette.primarySoft, borderRadius: 10, borderWidth: 4, height: 20, width: 20 },
  error: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  successTitle: { color: palette.success, fontSize: 18, fontWeight: '900' }
})
