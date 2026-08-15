import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { FilterChip } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { BottomTabInset } from '@/constants/theme';
import {
  radii,
  shadows,
  spacing,
  typography,
} from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface GroomingServiceItem {
  id: string;
  category: 'FULL' | 'HYGIENE' | 'DESHEDDING' | 'PUPPY';
  title: string;
  desc: string;
  price: number;
  duration: string;
  petApplicability: string;
  inclusions: string[];
}

const GROOMING_SERVICES_CATALOG: GroomingServiceItem[] = [
  {
    id: 'gs-1',
    category: 'FULL',
    title: 'Full Spa & Breed Haircut Package',
    desc: 'Complete luxury spa day with warm bath, blow dry, breed-standard haircut, ear cleaning & paw balm.',
    price: 1299,
    duration: '60 mins',
    petApplicability: 'All Dog Breeds & Sizes',
    inclusions: ['Warm Herbal Bath', 'Blow Dry & Fluff', 'Styling Haircut', 'Nail Trimming', 'Ear Cleaning', 'Paw Balm'],
  },
  {
    id: 'gs-2',
    category: 'HYGIENE',
    title: 'Basic Hygiene Bath & Tick Protection',
    desc: 'Anti-tick bath using natural neem extracts, sanitary area trimming, paw massage & nail buffing.',
    price: 699,
    duration: '40 mins',
    petApplicability: 'Small & Medium Dogs / Cats',
    inclusions: ['Anti-Tick Bath', 'Sanitary Trim', 'Paw Buffing', 'Scented Spray'],
  },
  {
    id: 'gs-3',
    category: 'DESHEDDING',
    title: 'De-Shedding & Undercoat Furminator',
    desc: 'Deep undercoat de-shedding treatment reducing loose fur for heavy-coat breeds.',
    price: 899,
    duration: '45 mins',
    petApplicability: 'Golden Retrievers, Huskies, Labs',
    inclusions: ['De-Shedding Shampoo', 'Furminator Raking', 'Blow Out', 'Coat Conditioning'],
  },
  {
    id: 'gs-4',
    category: 'PUPPY',
    title: 'Puppy First Spa Experience',
    desc: 'Ultra-gentle tearless bath for puppies under 6 months, warm fluff dry, paw balm & puppy treat cup.',
    price: 499,
    duration: '30 mins',
    petApplicability: 'Puppies (2-6 Months)',
    inclusions: ['Tearless Shampoo', 'Gentle Fluff Dry', 'Nail Clip', 'Treat Cup'],
  },
];

const FILTERS = [
  { id: 'ALL', label: 'All Services' },
  { id: 'FULL', label: 'Full Spa' },
  { id: 'HYGIENE', label: 'Hygiene Baths' },
  { id: 'DESHEDDING', label: 'De-Shedding' },
  { id: 'PUPPY', label: 'Puppy Spa' },
] as const;

export default function GroomingServicesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const filteredServices = useMemo(() => {
    if (filterCategory === 'ALL') return GROOMING_SERVICES_CATALOG;
    return GROOMING_SERVICES_CATALOG.filter((service) => service.category === filterCategory);
  }, [filterCategory]);

  return (
    <ScreenShell
      scroll={false}
      header={<ScreenHeader title="Grooming Services & Spa" subtitle="Certified pet groomers in Tirupati" />}
      contentContainerStyle={styles.shellContent}
      testID="grooming-services-screen"
    >
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.filterList}
        style={styles.filterRow}
        renderItem={({ item }) => (
          <FilterChip
            label={item.label}
            selected={filterCategory === item.id}
            onPress={() => setFilterCategory(item.id)}
          />
        )}
      />

      <FlatList
        style={styles.serviceList}
        data={filteredServices}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View
            style={[
              styles.serviceCard,
              shadows.raised,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardCopy}>
                <StatusBadge label={`⏱ ${item.duration}`} color={theme.primary} />
                <ThemedText style={[styles.serviceTitle, { color: theme.text }]}>{item.title}</ThemedText>
                <ThemedText numberOfLines={2} style={[styles.applicability, { color: theme.textSecondary }]}>
                  🐾 {item.petApplicability}
                </ThemedText>
              </View>
              <ThemedText style={[styles.price, { color: theme.primary }]}>₹{item.price}</ThemedText>
            </View>

            <ThemedText style={[styles.desc, { color: theme.textSecondary }]}>{item.desc}</ThemedText>

            <View style={styles.inclusionGrid}>
              {item.inclusions.map((inclusion) => (
                <StatusBadge key={inclusion} label={`✓ ${inclusion}`} color={theme.success} />
              ))}
            </View>

            <PrimaryButton
              label="Choose live slot & pay"
              onPress={() => router.push('/groom' as never)}
            />
          </View>
        )}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { paddingHorizontal: spacing.x4, paddingTop: spacing.x3, gap: spacing.x3 },
  filterRow: { flexGrow: 0, minHeight: 44 },
  filterList: { gap: spacing.x2, paddingRight: spacing.x6 },
  serviceList: { flex: 1 },
  listContent: { gap: spacing.x4, paddingBottom: BottomTabInset + spacing.x8 },
  serviceCard: { padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, gap: spacing.x3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.x3 },
  cardCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  serviceTitle: { ...typography.headline, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  applicability: { fontSize: 12, lineHeight: 18 },
  price: { ...typography.headline, fontSize: 20, fontWeight: '900' },
  desc: { fontSize: 13, lineHeight: 19 },
  inclusionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
});
