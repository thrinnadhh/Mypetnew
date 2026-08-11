import { Link, router, usePathname } from 'expo-router'
import type { ReactNode } from 'react'
import { Alert, Image, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useCart } from './cartContext'
import type { CartProduct } from './cartContext'
import { metrics, palette, text } from './theme'

type PageProps = {
  readonly children: ReactNode
  readonly title?: string
  readonly subtitle?: string
  readonly showBack?: boolean
  readonly bottomNav?: boolean
  readonly right?: ReactNode
}

export interface ProductViewModel {
  readonly id: string
  readonly outletId?: string
  readonly name: string
  readonly merchant?: string
  readonly pricePaise: number
  readonly image?: string
  readonly badge?: string
  readonly viewOnly?: boolean
}

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0

export function Page({ children, title, subtitle, showBack = false, bottomNav = true, right }: PageProps) {
  return (
    <View style={styles.safe}>
      {(title !== undefined || showBack || right !== undefined) ? <AppHeader title={title} showBack={showBack} right={right} /> : null}
      {subtitle !== undefined ? <View style={styles.subtitleWrap}><Text style={text.muted}>{subtitle}</Text></View> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent} style={styles.scroll}>
        <View style={styles.content}>{children}</View>
      </ScrollView>
      {bottomNav ? <BottomNav /> : null}
    </View>
  )
}

export function AppHeader({ title, showBack, right }: { readonly title?: string; readonly showBack?: boolean; readonly right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {showBack ? <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => { router.back() }} style={styles.iconButton}><Text style={styles.iconText}>‹</Text></Pressable> : null}
      </View>
      <Text numberOfLines={1} style={styles.headerTitle}>{title ?? 'MyPetNow'}</Text>
      <View style={[styles.headerSide, styles.headerSideRight]}>{right}</View>
    </View>
  )
}

export function HomeHeader() {
  return (
    <View style={styles.homeHeader}>
      <View style={styles.locationBlock}>
        <Text style={styles.locationPin}>⌖</Text>
        <View style={styles.flex1}>
          <Text style={styles.locationTitle}>Home⌄</Text>
          <Text numberOfLines={1} style={styles.locationText}>Tirupati, Andhra Pradesh</Text>
        </View>
      </View>
      <Link href="/profile" asChild>
        <Pressable accessibilityLabel="Open profile" accessibilityRole="button" style={styles.avatarButton}>
          <Image source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA2KsW7gWLv5UgbYQyePDKB5PUl6E_MlrrcsyIn8ExEFGpcuOuoWX_5iK1u6HVWAVgHbQ4KLaft9SCiE5Sf2svsAm5g4sTQIId5YJxG_QRIEf-VSN9S-9qvGxkChVs8K2gPIQ9dMJ1_0WdRywB1FEphKT3JKGzMWtBwX1TXW9FBDnV43dTvJCdttet_Fm7angT28GP180qAmNQAymxY0rohM0qZelZUSvPeeeQFF6H4JosS0U0Ka05a8vCriklgcplLDwqvatiVRFM' }} style={styles.avatar} />
        </Pressable>
      </Link>
    </View>
  )
}

export function SearchBox({ placeholder = 'Search food, toys, grooming...', value, onChangeText, onSubmit }: { readonly placeholder?: string; readonly value?: string; readonly onChangeText?: (value: string) => void; readonly onSubmit?: () => void }) {
  return (
    <View style={styles.searchBox}>
      <Text style={styles.searchIcon}>⌕</Text>
      <TextInput
        accessibilityLabel={placeholder}
        onChangeText={onChangeText}
        onSubmitEditing={() => { onSubmit?.() }}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        returnKeyType="search"
        style={styles.searchInput}
        value={value}
      />
      <View style={styles.searchDivider} />
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.mic}>⌕</Text>
    </View>
  )
}

export function SectionHeader({ title, action, onAction }: { readonly title: string; readonly action?: string; readonly onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={text.section}>{title}</Text>
      {action !== undefined
        ? onAction !== undefined
          ? <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable>
          : <Text style={styles.sectionHint}>{action}</Text>
        : null}
    </View>
  )
}

export function Chip({ label, active = false }: { readonly label: string; readonly active?: boolean }) {
  return <View style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></View>
}

export function PrimaryButton({ label, onPress, disabled = false, compact = false }: { readonly label: string; readonly onPress?: () => void; readonly disabled?: boolean; readonly compact?: boolean }) {
  const inactive = disabled || onPress === undefined
  return (
    <Pressable accessibilityRole="button" disabled={inactive} onPress={onPress} style={({ pressed }) => [styles.primaryButton, compact && styles.primaryButtonCompact, inactive && styles.buttonDisabled, pressed && !inactive && styles.buttonPressed]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

export function SecondaryButton({ label, onPress, disabled = false }: { readonly label: string; readonly onPress?: () => void; readonly disabled?: boolean }) {
  const inactive = disabled || onPress === undefined
  return <Pressable accessibilityRole="button" disabled={inactive} onPress={onPress} style={[styles.secondaryButton, inactive && styles.buttonDisabled]}><Text style={styles.secondaryButtonText}>{label}</Text></Pressable>
}

export function Badge({ label, tone = 'amber' }: { readonly label: string; readonly tone?: 'amber' | 'red' | 'green' | 'blue' }) {
  const toneStyle = tone === 'red' ? styles.badgeRed : tone === 'green' ? styles.badgeGreen : tone === 'blue' ? styles.badgeBlue : styles.badgeAmber
  return <View style={[styles.badge, toneStyle]}><Text style={styles.badgeText}>{label}</Text></View>
}

export function CategoryGrid({ items, onPress }: { readonly items: readonly { readonly label: string; readonly icon: string }[]; readonly onPress?: (label: string) => void }) {
  return (
    <View style={styles.categoryGrid}>
      {items.map((item) => (
        <Pressable accessibilityRole="button" disabled={onPress === undefined} key={item.label} onPress={() => { onPress?.(item.label) }} style={styles.categoryItem}>
          <View style={styles.categoryCircle}><Text style={styles.categoryEmoji}>{item.icon}</Text></View>
          <Text numberOfLines={2} style={styles.categoryLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function ProductGrid({ products }: { readonly products: readonly ProductViewModel[] }) {
  const { width } = useWindowDimensions()
  const available = Math.min(width, metrics.contentMax) - (metrics.pageGutter * 2)
  const columns = width >= 700 ? 3 : 2
  const cardWidth = (available - metrics.cardGap * (columns - 1)) / columns
  return <View style={styles.productGrid}>{products.map((product) => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
}

function ProductCard({ product, width }: { readonly product: ProductViewModel; readonly width: number }) {
  const { addProduct, replaceWithProduct } = useCart()

  const add = () => {
    if (product.outletId === undefined || product.viewOnly === true) return
    const cartProduct: CartProduct = {
      listingId: product.id,
      outletId: product.outletId,
      name: product.name,
      pricePaise: product.pricePaise,
      image: product.image
    }
    const result = addProduct(cartProduct)
    if (result === 'outlet-conflict') {
      Alert.alert(
        'Start a new cart?',
        'Your cart can contain items from only one merchant. Replace the current cart with this item?',
        [
          { text: 'Keep current cart', style: 'cancel' },
          { text: 'Replace cart', style: 'destructive', onPress: () => { replaceWithProduct(cartProduct) } }
        ]
      )
    }
  }

  return (
    <View style={[styles.productCard, { width }]}>
      <View style={styles.productImageWrap}>
        {product.image !== undefined ? <Image resizeMode="cover" source={{ uri: product.image }} style={styles.productImage} /> : <View style={styles.productPlaceholder}><Text style={styles.productPlaceholderText}>🐾</Text></View>}
        {product.badge !== undefined ? <View style={styles.productBadge}><Badge label={product.badge} tone={product.badge.includes('SALE') ? 'red' : 'amber'} /></View> : null}
      </View>
      <View style={styles.productBody}>
        {product.merchant !== undefined ? <Text numberOfLines={1} style={styles.merchantText}>Sold by {product.merchant}</Text> : null}
        <Text numberOfLines={2} style={styles.productName}>{product.name}</Text>
        <View style={styles.productFooter}>
          <Text style={styles.productPrice}>{formatPaise(product.pricePaise)}</Text>
          {product.viewOnly === true
            ? <Badge label="VIEW" tone="blue" />
            : product.outletId === undefined
              ? <Badge label="PREVIEW" tone="blue" />
              : <Pressable accessibilityLabel={`Add ${product.name}`} accessibilityRole="button" hitSlop={4} onPress={add} style={styles.addButton}><Text style={styles.addButtonText}>＋</Text></Pressable>}
        </View>
      </View>
    </View>
  )
}

export function StoreCard({ name, subtitle, image, rating = '4.8', distance = '1.2 km', href = '/shop' }: { readonly name: string; readonly subtitle: string; readonly image: string; readonly rating?: string; readonly distance?: string; readonly href?: string }) {
  return (
    <Link href={href as never} asChild>
      <Pressable accessibilityRole="button" style={styles.storeCard}>
        <Image resizeMode="cover" source={{ uri: image }} style={styles.storeImage} />
        <View style={styles.storeBody}>
          <Text numberOfLines={1} style={styles.storeName}>{name}</Text>
          <Text numberOfLines={1} style={styles.storeSubtitle}>{subtitle}</Text>
          <View style={styles.metaRow}><Badge label={`★ ${rating}`} tone="green" /><Text style={styles.metaText}>◉ {distance}</Text></View>
        </View>
      </Pressable>
    </Link>
  )
}

export function InfoCard({ title, children, tone = 'default' }: { readonly title?: string; readonly children: ReactNode; readonly tone?: 'default' | 'blue' | 'green' | 'red' }) {
  return <View style={[styles.infoCard, tone === 'blue' && styles.infoBlue, tone === 'green' && styles.infoGreen, tone === 'red' && styles.infoRed]}>{title !== undefined ? <Text style={styles.infoTitle}>{title}</Text> : null}{children}</View>
}

export function BottomNav() {
  const pathname = usePathname()
  const { itemCount } = useCart()
  const items = [
    { href: '/', label: 'Home', icon: '⌂' },
    { href: '/catalog', label: 'Explore', icon: '⌕' },
    { href: '/orders', label: 'Orders', icon: '▣' },
    { href: '/profile', label: 'Profile', icon: '♙' }
  ] as const

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href} asChild>
            <Pressable accessibilityRole="tab" style={[styles.navItem, active && styles.navItemActive]}>
              <Text style={[styles.navIcon, active && styles.navActive]}>{item.icon}</Text>
              <Text style={[styles.navLabel, active && styles.navActive]}>{item.label}</Text>
              {item.href === '/catalog' && itemCount > 0 ? <View style={styles.cartCount}><Text style={styles.cartCountText}>{itemCount > 99 ? '99+' : itemCount}</Text></View> : null}
            </Pressable>
          </Link>
        )
      })}
      <Link href="/cart" asChild>
        <Pressable accessibilityLabel={`Cart with ${String(itemCount)} items`} accessibilityRole="button" style={styles.cartShortcut}>
          <Text style={styles.cartShortcutIcon}>🛒</Text>
          {itemCount > 0 ? <View style={styles.cartShortcutCount}><Text style={styles.cartCountText}>{itemCount > 99 ? '99+' : itemCount}</Text></View> : null}
        </Pressable>
      </Link>
    </View>
  )
}

export function formatPaise(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100)
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background, paddingTop: topInset },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },
  content: { alignSelf: 'center', gap: metrics.sectionGap, paddingHorizontal: metrics.pageGutter, paddingTop: 12, width: '100%', maxWidth: metrics.contentMax },
  subtitleWrap: { alignSelf: 'center', paddingHorizontal: metrics.pageGutter, paddingBottom: 4, width: '100%', maxWidth: metrics.contentMax },
  flex1: { flex: 1 },
  header: { alignItems: 'center', backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 58, paddingHorizontal: 8 },
  headerSide: { width: 58, minHeight: 48, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: { color: palette.text, flex: 1, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  iconButton: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  iconText: { color: palette.text, fontSize: 34, lineHeight: 36 },
  homeHeader: { alignItems: 'center', alignSelf: 'center', backgroundColor: palette.surface, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 72, paddingHorizontal: metrics.pageGutter, width: '100%', maxWidth: metrics.contentMax },
  locationBlock: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8 },
  locationPin: { color: palette.primary, fontSize: 22 },
  locationTitle: { color: palette.text, fontSize: 14, fontWeight: '800' },
  locationText: { color: palette.muted, fontSize: 11, maxWidth: 210 },
  avatarButton: { alignItems: 'center', borderColor: palette.amber, borderRadius: 24, borderWidth: 2, height: 48, justifyContent: 'center', width: 48 },
  avatar: { borderRadius: 20, height: 40, width: 40 },
  searchBox: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, flexDirection: 'row', minHeight: metrics.input, paddingHorizontal: 14 },
  searchIcon: { color: palette.text, fontSize: 24, marginRight: 8 },
  searchInput: { color: palette.text, flex: 1, fontSize: 15, minHeight: metrics.input, paddingVertical: 0 },
  searchDivider: { backgroundColor: palette.border, height: 22, marginHorizontal: 8, width: 1 },
  mic: { color: palette.primary, fontSize: 18 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionAction: { color: palette.primary, fontSize: 13, fontWeight: '700' },
  sectionHint: { color: palette.muted, fontSize: 11, fontWeight: '700' },
  chip: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 14 },
  chipActive: { backgroundColor: palette.primarySoft, borderColor: palette.primary },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: palette.primary },
  primaryButton: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', minHeight: metrics.button, paddingHorizontal: 18 },
  primaryButtonCompact: { minHeight: 48, paddingHorizontal: 14 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.82 },
  secondaryButton: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.primary, borderRadius: metrics.radiusSm, borderWidth: 1, justifyContent: 'center', minHeight: metrics.button, paddingHorizontal: 18 },
  secondaryButtonText: { color: palette.primary, fontSize: 14, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  badgeAmber: { backgroundColor: palette.amberSoft },
  badgeRed: { backgroundColor: palette.dangerSoft },
  badgeGreen: { backgroundColor: palette.successSoft },
  badgeBlue: { backgroundColor: palette.primarySoft },
  badgeText: { color: palette.text, fontSize: 9, fontWeight: '900' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  categoryItem: { alignItems: 'center', gap: 7, minHeight: 86, width: '23%' },
  categoryCircle: { alignItems: 'center', backgroundColor: palette.surfaceBlue, borderRadius: 30, height: 58, justifyContent: 'center', width: 58 },
  categoryEmoji: { fontSize: 26 },
  categoryLabel: { color: palette.text, fontSize: 11, fontWeight: '700', lineHeight: 14, textAlign: 'center' },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: metrics.cardGap },
  productCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, overflow: 'hidden' },
  productImageWrap: { aspectRatio: 1, backgroundColor: '#F1F4F8', position: 'relative', width: '100%' },
  productImage: { height: '100%', width: '100%' },
  productPlaceholder: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  productPlaceholderText: { fontSize: 38 },
  productBadge: { left: 7, position: 'absolute', top: 7 },
  productBody: { gap: 5, padding: 10 },
  merchantText: { color: palette.muted, fontSize: 9, textTransform: 'uppercase' },
  productName: { color: palette.text, fontSize: 12, fontWeight: '700', lineHeight: 16, minHeight: 32 },
  productFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  productPrice: { color: palette.text, fontSize: 14, fontWeight: '900' },
  addButton: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  addButtonText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 24 },
  storeCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, overflow: 'hidden', width: 220 },
  storeImage: { backgroundColor: palette.surfaceSoft, height: 108, width: '100%' },
  storeBody: { gap: 4, padding: 10 },
  storeName: { color: palette.text, fontSize: 13, fontWeight: '800' },
  storeSubtitle: { color: palette.muted, fontSize: 10 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 4 },
  metaText: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  infoCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, gap: 10, padding: 16 },
  infoBlue: { backgroundColor: '#F2F7FF', borderColor: '#CFE0FF' },
  infoGreen: { backgroundColor: '#EFFAF5', borderColor: '#C8EEDD' },
  infoRed: { backgroundColor: '#FFF4F3', borderColor: '#F3D0CB' },
  infoTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  bottomNav: { alignItems: 'stretch', backgroundColor: palette.surface, borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 6 },
  navItem: { alignItems: 'center', borderRadius: 10, flex: 1, gap: 1, justifyContent: 'center', minHeight: 52, paddingVertical: 4, position: 'relative' },
  navItemActive: { backgroundColor: palette.primarySoft },
  navIcon: { color: palette.muted, fontSize: 20 },
  navLabel: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  navActive: { color: palette.primary },
  cartCount: { alignItems: 'center', backgroundColor: palette.danger, borderRadius: 9, height: 18, justifyContent: 'center', minWidth: 18, paddingHorizontal: 4, position: 'absolute', right: 10, top: 2 },
  cartCountText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  cartShortcut: { alignItems: 'center', justifyContent: 'center', minHeight: 52, minWidth: 48, position: 'relative' },
  cartShortcutIcon: { fontSize: 20 },
  cartShortcutCount: { alignItems: 'center', backgroundColor: palette.danger, borderRadius: 9, height: 18, justifyContent: 'center', minWidth: 18, paddingHorizontal: 4, position: 'absolute', right: 1, top: 1 }
})
