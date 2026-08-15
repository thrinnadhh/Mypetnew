import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function GuideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();

  const guideTitle = id === 'puppy-nutrition-0-2-mo'
    ? 'Puppy Nutrition Guide (0 - 2 Months)'
    : id === 'puppy-growth-2-12-mo'
      ? 'Puppy Growth Tracker (2 - 12 Months)'
      : 'Coat & Skin Health Masterclass';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title="PetCare Health Guide" subtitle="Verified Veterinary Knowledge" />

      <View style={[styles.heroCard, Shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <StatusBadge label="Veterinary Approved" color={theme.success} />

        <ThemedText style={[styles.guideTitle, { color: theme.text }]}>{guideTitle}</ThemedText>
        <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>⏱️ 4 min read • Updated for Pet Parents</ThemedText>
      </View>

      <View style={styles.contentSection}>
        <ThemedText style={[styles.sectionHeading, { color: theme.text }]}>Key Takeaways for Pet Parents</ThemedText>

        <View style={styles.pointRow}>
          <AppIcon name="sparkle" color={theme.primary} size={20} />
          <ThemedText style={[styles.pointText, { color: theme.text }]}>
            {"1. Feed high-protein, age-appropriate formulated food tailored to your pet's size and breed."}
          </ThemedText>

        </View>

        <View style={styles.pointRow}>
          <AppIcon name="sparkle" color={theme.primary} size={20} />
          <ThemedText style={[styles.pointText, { color: theme.text }]}>
            2. Maintain a strict vaccination and deworming schedule approved by a licensed veterinarian.
          </ThemedText>
        </View>

        <View style={styles.pointRow}>
          <AppIcon name="sparkle" color={theme.primary} size={20} />
          <ThemedText style={[styles.pointText, { color: theme.text }]}>
            3. Ensure fresh drinking water is accessible 24/7 and avoid sudden dietary transitions.
          </ThemedText>
        </View>
      </View>

      <View style={styles.actionFooter}>
        <PrimaryButton label="Consult a Vet Specialist" onPress={() => router.push('/vet' as never)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three },
  heroCard: { padding: Spacing.three, borderRadius: Radius.lg, borderWidth: 1, gap: Spacing.one, marginTop: Spacing.two },
  guideTitle: { fontSize: 18, fontWeight: '700' },
  contentSection: { marginTop: Spacing.four, gap: Spacing.three },
  sectionHeading: { fontSize: 16, fontWeight: '700' },
  pointRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  pointText: { flex: 1, fontSize: 14 },
  actionFooter: { marginTop: Spacing.five },
});
