import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { LocationModal, NotifyCityModal } from '@/components/location-modal';
import { ThemedText } from '@/components/themed-text';
import { BannerCarousel } from '@/components/ui/banner-carousel';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { PROMO_BANNERS } from '@/constants/content';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useLocation } from '@/context/LocationContext';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { fetchBanners, fetchGuides, type GuideArticle, type PromoBanner } from '@/services/content';
import { DEMO_MEDIA } from '@/services/demo-customer-data';

const CARD_WIDTH = 236;
const CARD_GAP = 12;

interface ShortcutItem {
  id: string;
  label: string;
  icon: AppIconName;
  route: string;
}

interface CategoryItem {
  id: string;
  label: string;
  image: string;
  route: string;
}

interface DiscoveryCardItem {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  fallbackImage?: string;
  rating?: string;
  meta: string;
  metaIcon: AppIconName;
  route: string;
  likes?: number;
  authorName?: string;
  companyName?: string;
}

const QUICK_ACTIONS: ShortcutItem[] = [
  { id: 'favourites', label: 'Favourites', icon: 'heart', route: '/favourites' },
  { id: 'orders', label: 'Orders', icon: 'document', route: '/(tabs)/orders' },
  { id: 'new-arrivals', label: 'New Arrivals', icon: 'sparkle', route: '/category/new-arrivals' },
];

const HEALTH_ACTIONS: ShortcutItem[] = [
  { id: 'vaccinations', label: 'Vaccinations & Tablets', icon: 'medical', route: '/health/vaccinations' },
  { id: 'reports', label: 'Reports', icon: 'document', route: '/health/reports' },
  { id: 'appointments', label: 'Appointments', icon: 'calendar', route: '/appointments' },
];

const CATEGORIES: CategoryItem[] = [
  { id: 'food', label: 'Food & Nutrition', route: '/category/food', image: DEMO_MEDIA.food },
  { id: 'grooming', label: 'Grooming Services', route: '/groom', image: DEMO_MEDIA.grooming },
  { id: 'hospitals', label: 'Hospitals & Care', route: '/vet', image: DEMO_MEDIA.hospital },
  { id: 'treats', label: 'Treats & Chews', route: '/category/treats', image: DEMO_MEDIA.treats },
  { id: 'toys', label: 'Toys & Enrichment', route: '/category/toys', image: DEMO_MEDIA.toys },
  { id: 'travel', label: 'Travel & Apparel', route: '/category/travel', image: DEMO_MEDIA.travel },
];

const FILTERS = ['All', 'Dry Food', 'Wet Food', 'Puppy', 'Adult', 'Senior'];

const FOOD_AND_NUTRITION: DiscoveryCardItem[] = [
  {
    id: 'shop-1',
    title: 'The Healthy Hound Nutrition Hub',
    subtitle: 'Premium Food, Supplements & Diet Care',
    image: DEMO_MEDIA.food,
    rating: '4.9',
    meta: '20 mins',
    metaIcon: 'clock',
    route: '/shop/the-healthy-hound',
  },
  {
    id: 'shop-2',
    title: 'The Posh Paws Superstore',
    subtitle: 'Food, Treats, Toys & Travel Essentials',
    image: DEMO_MEDIA.nutrition,
    rating: '4.8',
    meta: '25 mins',
    metaIcon: 'clock',
    route: '/shop/the-posh-paws',
  },
  {
    id: 'shop-3',
    title: 'PetCare Pharmacy & Essentials',
    subtitle: 'Nutrition, Hygiene & Wellness Supplies',
    image: DEMO_MEDIA.store,
    rating: '4.7',
    meta: '30 mins',
    metaIcon: 'clock',
    route: '/shop/petcare-pharmacy',
  },
];

const GROOMING_NEARBY: DiscoveryCardItem[] = [
  {
    id: 'groom-1',
    title: 'Paws & Bubbles Spa',
    subtitle: 'Luxury Grooming & Styling',
    image: DEMO_MEDIA.grooming,
    rating: '4.8',
    meta: '0.8 km away',
    metaIcon: 'location',
    route: '/groom',
  },
  {
    id: 'groom-2',
    title: 'The Grooming Room',
    subtitle: 'Professional Pet Grooming',
    image: DEMO_MEDIA.toys,
    fallbackImage: DEMO_MEDIA.grooming,
    rating: '4.6',
    meta: '1.9 km away',
    metaIcon: 'location',
    route: '/groom',
  },
];

const HOSPITALS_AND_CARE: DiscoveryCardItem[] = [
  {
    id: 'hosp-1',
    title: 'City Pet Hospital',
    subtitle: 'Emergency & General Care',
    image: DEMO_MEDIA.hospital,
    rating: '4.9',
    meta: '1.2 km away',
    metaIcon: 'location',
    route: '/vet',
  },
  {
    id: 'hosp-2',
    title: 'PetCare Wellness Center',
    subtitle: 'Preventive & Specialist Veterinary Care',
    image: DEMO_MEDIA.store,
    fallbackImage: DEMO_MEDIA.hospital,
    rating: '4.7',
    meta: '2.5 km away',
    metaIcon: 'location',
    route: '/vet',
  },
];

const GUIDES: DiscoveryCardItem[] = [
  {
    id: 'guide-1',
    title: 'Puppy Nutrition (0–2 mo)',
    subtitle: 'Dietary guide',
    image: DEMO_MEDIA.food,
    meta: '3 min read',
    metaIcon: 'document',
    route: '/guides',
    likes: 128,
    authorName: 'Dr. Ananya Rao',
    companyName: 'City Pet Hospital',
  },
  {
    id: 'guide-2',
    title: 'Puppy Growth (2–12 mo)',
    subtitle: 'Milestone tracking',
    image: DEMO_MEDIA.guide,
    meta: '4 min read',
    metaIcon: 'document',
    route: '/guides',
    likes: 94,
    authorName: 'Dr. Vivek Sharma',
    companyName: 'PetCare Wellness Center',
  },
  {
    id: 'guide-3',
    title: 'Coat & Skin Health',
    subtitle: 'Seasonal care essentials',
    image: DEMO_MEDIA.grooming,
    meta: '5 min read',
    metaIcon: 'document',
    route: '/guides',
    likes: 76,
    authorName: 'Meera Reddy',
    companyName: 'Paws & Bubbles Spa',
  },
];

function SectionHeading({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>{title}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <ThemedText style={[styles.sectionAction, { color: theme.cta }]}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function DiscoveryCard({ item }: { item: DiscoveryCardItem }) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => router.push(item.route as never)}
      style={({ pressed }) => [
        styles.discoveryCard,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardImageWrap}>
        <ResilientRemoteImage
          uri={item.image}
          fallbackUri={item.fallbackImage ?? DEMO_MEDIA.store}
          style={styles.cardImage}
        />
        {item.rating ? (
          <View style={styles.ratingBadge}>
            <ThemedText style={styles.ratingText}>{item.rating}</ThemedText>
            <AppIcon name="star" color="#F59E0B" size={13} />
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <ThemedText style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>{item.title}</ThemedText>
        <ThemedText style={[styles.cardSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>{item.subtitle}</ThemedText>
        <View style={styles.metaRow}>
          <View style={[styles.metaPill, { backgroundColor: theme.muted }]}>
            <AppIcon name={item.metaIcon} color={theme.textSecondary} size={13} />
            <ThemedText style={[styles.metaText, { color: theme.text }]}>{item.meta}</ThemedText>
          </View>
          {typeof item.likes === 'number' ? (
            <View style={[styles.likePill, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name="heart" color={theme.primary} size={13} />
              <ThemedText style={[styles.likeText, { color: theme.primary }]}>{item.likes}</ThemedText>
            </View>
          ) : null}
        </View>
        {item.authorName || item.companyName ? (
          <ThemedText style={[styles.byline, { color: theme.textSecondary }]} numberOfLines={2}>
            By {item.authorName ?? 'MyPet Expert'}{item.companyName ? ` · ${item.companyName}` : ''}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

function HorizontalCardSection({
  title,
  items,
  actionLabel,
  onAction,
}: {
  title: string;
  items: DiscoveryCardItem[];
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeading title={title} actionLabel={actionLabel} onAction={onAction} />
      <ScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
        contentContainerStyle={styles.horizontalCards}
      >
        {items.map((item) => <DiscoveryCard key={item.id} item={item} />)}
      </ScrollView>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { activeCity, openLocationModal } = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [banners, setBanners] = useState<PromoBanner[]>(PROMO_BANNERS);
  const [guideItems, setGuideItems] = useState<DiscoveryCardItem[]>(GUIDES);

  useEffect(() => {
    void fetchBanners()
      .then((items) => setBanners(items.length > 0 ? items : PROMO_BANNERS))
      .catch(() => setBanners(PROMO_BANNERS));

    void fetchGuides(null)
      .then((articles) => {
        if (articles.length === 0) return;
        const images = [DEMO_MEDIA.food, DEMO_MEDIA.guide, DEMO_MEDIA.grooming, DEMO_MEDIA.hospital];
        setGuideItems(articles.slice(0, 6).map((article: GuideArticle, index) => ({
          id: article.id,
          title: article.title,
          subtitle: article.summary,
          image: images[index % images.length],
          fallbackImage: DEMO_MEDIA.guide,
          meta: `${article.readMinutes} min read`,
          metaIcon: 'document',
          route: '/guides',
          likes: article.likeCount,
          authorName: article.authorName,
          companyName: article.companyName,
        })));
      })
      .catch(() => setGuideItems(GUIDES));
  }, []);

  const firstName = useMemo(() => {
    if (typeof user?.user_metadata?.full_name === 'string') {
      return user.user_metadata.full_name.split(' ')[0];
    }
    return t('common.petParent');
  }, [t, user]);

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 10 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Pressable onPress={openLocationModal} style={styles.locationSummary} accessibilityRole="button">
            <AppIcon name="location" color={theme.primary} size={21} />
            <View style={styles.flexOne}>
              <View style={styles.locationTitleRow}>
                <ThemedText style={[styles.locationTitle, { color: theme.text }]}>Home</ThemedText>
                <AppIcon name="chevron" color={theme.textSecondary} size={13} />
              </View>
              <ThemedText style={[styles.locationSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                {activeCity.displayName}, {activeCity.state}
              </ThemedText>
            </View>
          </Pressable>

          <View style={styles.profileSummary}>
            <View style={styles.profileCopy}>
              <View style={styles.premiumPill}><ThemedText style={styles.premiumText}>Premium</ThemedText></View>
              <ThemedText style={[styles.profileName, { color: theme.textSecondary }]} numberOfLines={1}>{firstName}</ThemedText>
            </View>
            <View style={[styles.avatar, { borderColor: theme.warning, backgroundColor: theme.primarySoft }]}>
              <AppIcon name="paw" color={theme.primary} size={20} />
            </View>
          </View>
        </View>

        <View style={[styles.searchField, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" color={theme.textSecondary} size={20} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search for 'Pedigree' or 'Grooming'..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
            onSubmitEditing={() => {
              const value = searchQuery.trim();
              if (value) router.push({ pathname: '/search', params: { q: value } } as never);
            }}
          />
          <View style={[styles.searchDivider, { backgroundColor: theme.border }]} />
          <Pressable onPress={() => router.push({ pathname: '/search', params: { mic: 'true' } } as never)} hitSlop={8}>
            <AppIcon name="sparkle" color={theme.primary} size={19} />
          </Pressable>
        </View>

        <BannerCarousel banners={banners} onPress={() => router.push('/category/new-arrivals' as never)} />

        <View style={[styles.quickActions, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {QUICK_ACTIONS.map((action, index) => (
            <React.Fragment key={action.id}>
              {index > 0 ? <View style={[styles.quickDivider, { backgroundColor: theme.border }]} /> : null}
              <Pressable onPress={() => router.push(action.route as never)} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
                <AppIcon name={action.icon} color={theme.primary} size={21} />
                <ThemedText style={[styles.quickLabel, { color: theme.text }]}>{action.label}</ThemedText>
              </Pressable>
            </React.Fragment>
          ))}
        </View>

        <View style={[styles.healthPanel, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}>
          <View style={styles.healthTitleRow}>
            <AppIcon name="document" color={theme.primary} size={17} />
            <ThemedText style={[styles.healthTitle, { color: theme.text }]}>Reports & Health</ThemedText>
          </View>
          <View style={styles.healthGrid}>
            {HEALTH_ACTIONS.map((action) => (
              <Pressable
                key={action.id}
                onPress={() => router.push(action.route as never)}
                style={({ pressed }) => [styles.healthCard, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
              >
                <AppIcon name={action.icon} color={theme.primary} size={22} />
                <ThemedText style={[styles.healthLabel, { color: theme.text }]} numberOfLines={2}>{action.label}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={[styles.mindTitle, { color: theme.text }]}>What&apos;s on your pet&apos;s mind? ✨</ThemedText>
          <ThemedText style={[styles.mindSubtitle, { color: theme.textSecondary }]}>Choose from premium foods, grooming, hospitals and more</ThemedText>

          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {CATEGORIES.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => router.push(category.route as never)}
                style={({ pressed }) => [styles.categoryItem, pressed && styles.pressed]}
              >
                <View style={[styles.categoryImageWrap, { backgroundColor: theme.muted }]}>
                  <ResilientRemoteImage uri={category.image} fallbackUri={DEMO_MEDIA.store} style={styles.categoryImage} />
                </View>
                <ThemedText style={[styles.categoryLabel, { color: theme.textSecondary }]} numberOfLines={2}>{category.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((filter) => {
              const active = activeFilter === filter;
              return (
                <Pressable
                  key={filter}
                  onPress={() => setActiveFilter(filter)}
                  style={[styles.filterChip, { backgroundColor: active ? theme.primary : theme.muted }]}
                >
                  <ThemedText style={[styles.filterText, { color: active ? '#FFFFFF' : theme.textSecondary }]}>{filter}</ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <HorizontalCardSection title="Food & Nutrition Nearby 🏆" items={FOOD_AND_NUTRITION} actionLabel="View all" onAction={() => router.push('/category/food' as never)} />
        <HorizontalCardSection title="Grooming Nearby ✂️" items={GROOMING_NEARBY} actionLabel="View spas" onAction={() => router.push('/groom' as never)} />
        <HorizontalCardSection title="Hospitals & Care Nearby 🏥" items={HOSPITALS_AND_CARE} actionLabel="View hospitals" onAction={() => router.push('/vet' as never)} />
        <HorizontalCardSection title="Guides 🩺" items={guideItems} actionLabel="All guides" onAction={() => router.push('/guides' as never)} />
      </ScrollView>
      <LocationModal />
      <NotifyCityModal />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingHorizontal: Spacing.three, paddingBottom: 112, gap: 14 },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.86 },
  topRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  locationSummary: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  locationTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  locationSubtitle: { maxWidth: 190, fontSize: 11, lineHeight: 15 },
  profileSummary: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileCopy: { alignItems: 'flex-end', maxWidth: 88 },
  premiumPill: { borderRadius: 999, backgroundColor: '#FDBA2D', paddingHorizontal: 6, paddingVertical: 2 },
  premiumText: { color: '#4A2C00', fontSize: 9, lineHeight: 11, fontWeight: '900' },
  profileName: { marginTop: 2, fontSize: 10, lineHeight: 13 },
  avatar: { width: 39, height: 39, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  searchField: { height: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, ...Shadows.card },
  searchInput: { flex: 1, height: 46, fontSize: 14, paddingVertical: 0 },
  searchDivider: { width: 1, height: 20 },
  quickActions: { minHeight: 68, borderWidth: 1, borderRadius: Radius.xl, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, ...Shadows.card },
  quickAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7 },
  quickDivider: { width: 1, height: 32 },
  quickLabel: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  healthPanel: { borderRadius: Radius.xl, borderWidth: 1, padding: 10, gap: 9 },
  healthTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  healthTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  healthGrid: { flexDirection: 'row', gap: 7 },
  healthCard: { flex: 1, minHeight: 74, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', gap: 6 },
  healthLabel: { textAlign: 'center', fontSize: 10, lineHeight: 13, fontWeight: '600' },
  section: { gap: 10, marginTop: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { flex: 1, fontSize: 18, lineHeight: 23, fontWeight: '800' },
  sectionAction: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  mindTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  mindSubtitle: { marginTop: -8, fontSize: 11, lineHeight: 15 },
  categoryRow: { gap: 13, paddingVertical: 2, paddingRight: Spacing.three },
  categoryItem: { width: 72, alignItems: 'center', gap: 7 },
  categoryImageWrap: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  categoryImage: { width: '100%', height: '100%' },
  categoryLabel: { minHeight: 29, textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '600' },
  filterRow: { gap: 8, paddingRight: Spacing.three },
  filterChip: { minHeight: 30, borderRadius: 999, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  horizontalCards: { gap: CARD_GAP, paddingRight: Spacing.three, paddingBottom: 2 },
  discoveryCard: { width: CARD_WIDTH, borderWidth: 1, borderRadius: 12, overflow: 'hidden', ...Shadows.card },
  cardImageWrap: { height: 130, position: 'relative', overflow: 'hidden' },
  cardImage: { width: '100%', height: '100%' },
  ratingBadge: { position: 'absolute', top: 8, right: 8, minHeight: 27, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.94)', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4 },
  ratingText: { color: '#152338', fontSize: 11, lineHeight: 14, fontWeight: '900' },
  cardBody: { padding: 10, gap: 3 },
  cardTitle: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  cardSubtitle: { fontSize: 11, lineHeight: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaPill: { alignSelf: 'flex-start', minHeight: 25, marginTop: 4, borderRadius: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  likePill: { minHeight: 25, borderRadius: 999, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  likeText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  byline: { marginTop: 2, fontSize: 10, lineHeight: 14, fontWeight: '600' },
});
