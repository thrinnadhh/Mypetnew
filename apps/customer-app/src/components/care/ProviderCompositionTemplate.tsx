import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export interface ProviderCompositionData {
  id: string;
  name: string;
  type: 'VET_HOSPITAL' | 'GROOMING_CENTER';
  tagline: string;
  address: string;
  phone: string;
  rating: string;
  reviewCount: number;
  heroImageUrl: string;
  distanceKm: number;
  operatingHours: string;
  emergencyCare?: boolean;
  services: Array<{
    name: string;
    desc: string;
    fee: number;
    duration?: string;
  }>;
  staffRoster: Array<{
    name: string;
    role: string;
    experience: string;
    avatarUrl?: string;
  }>;
  facilities: string[];
}

export function ProviderCompositionTemplate({ provider }: { provider: ProviderCompositionData }) {
  const router = useRouter();
  const theme = useTheme();
  const isVet = provider.type === 'VET_HOSPITAL';
  const bookingRoute = isVet ? '/vet' : '/groom';
  const openLiveBooking = () => router.push(bookingRoute as never);

  return (
    <ScreenShell
      header={<ScreenHeader title={provider.name} subtitle={provider.tagline} />}
      footer={
        <View style={[styles.stickyFooter, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <PrimaryButton
            label={isVet ? 'Choose OPD slot & pay' : 'Choose grooming slot & pay'}
            onPress={openLiveBooking}
          />
        </View>
      }
      contentContainerStyle={styles.shellContent}
      testID="provider-composition-screen"
    >
      <View style={styles.heroCard}>
        <Image source={{ uri: provider.heroImageUrl }} style={styles.heroImage} resizeMode="cover" />
        <View style={styles.heroOverlay}>
          <StatusBadge label={provider.rating} color={theme.warning} />
          <StatusBadge label={`${provider.distanceKm} km away`} color={theme.primary} />
          {provider.emergencyCare ? <StatusBadge label="24/7 ICU" color={theme.danger} /> : null}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={[styles.title, { color: theme.text }]}>{provider.name}</ThemedText>
        <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>📍 {provider.address}</ThemedText>
        <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>🕒 Hours: {provider.operatingHours}</ThemedText>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          onPress={() => void Linking.openURL(`tel:${provider.phone}`)}
          style={[styles.actionButton, { backgroundColor: theme.primarySoft }]}
          accessibilityRole="button"
          accessibilityLabel={`Call ${provider.name}`}
        >
          <AppIcon name="paw" color={theme.primary} size={18} />
          <ThemedText style={[styles.actionLabel, { color: theme.primary }]}>Call</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(provider.address)}`)}
          style={[styles.actionButton, { backgroundColor: theme.primarySoft }]}
          accessibilityRole="button"
          accessibilityLabel={`Directions to ${provider.name}`}
        >
          <AppIcon name="location" color={theme.primary} size={18} />
          <ThemedText style={[styles.actionLabel, { color: theme.primary }]}>Directions</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => router.push(`/chat?recipient=${encodeURIComponent(provider.name)}` as never)}
          style={[styles.actionButton, { backgroundColor: theme.primarySoft }]}
          accessibilityRole="button"
          accessibilityLabel={`Message ${provider.name}`}
        >
          <AppIcon name="sparkle" color={theme.primary} size={18} />
          <ThemedText style={[styles.actionLabel, { color: theme.primary }]}>Message</ThemedText>
        </Pressable>
      </View>

      <View style={styles.section}>
        <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>
          {isVet ? 'Medical Services & OPD Fees' : 'Spa & Grooming Packages'}
        </ThemedText>
        <View style={styles.cardList}>
          {provider.services.map((service) => (
            <View
              key={service.name}
              style={[styles.serviceCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            >
              <View style={styles.serviceCopy}>
                <ThemedText style={[styles.serviceTitle, { color: theme.text }]}>{service.name}</ThemedText>
                <ThemedText style={[styles.serviceDescription, { color: theme.textSecondary }]}>{service.desc}</ThemedText>
                {service.duration ? <ThemedText style={[styles.duration, { color: theme.primary }]}>⏱ {service.duration}</ThemedText> : null}
              </View>
              <View style={styles.serviceAction}>
                <ThemedText style={[styles.fee, { color: theme.primary }]}>₹{service.fee}</ThemedText>
                <Pressable
                  onPress={openLiveBooking}
                  style={[styles.bookButton, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose a live slot for ${service.name}`}
                >
                  <ThemedText style={styles.bookLabel}>Book & Pay</ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>Facilities & Highlights</ThemedText>
        <View style={styles.chipGrid}>
          {provider.facilities.map((facility) => <StatusBadge key={facility} label={`✓ ${facility}`} color={theme.primary} />)}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>{isVet ? 'Veterinary Specialists' : 'Certified Groomers'}</ThemedText>
        <View style={styles.rosterList}>
          {provider.staffRoster.map((staff) => (
            <View
              key={`${staff.name}-${staff.role}`}
              style={[styles.staffCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            >
              <AppIcon name="paw" color={theme.primary} size={24} />
              <View style={styles.staffCopy}>
                <ThemedText style={[styles.staffName, { color: theme.text }]}>{staff.name}</ThemedText>
                <ThemedText style={[styles.staffMeta, { color: theme.textSecondary }]}>{staff.role} · {staff.experience}</ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: { gap: spacing.x4 },
  heroCard: { width: '100%', height: 210, borderRadius: radii.card, overflow: 'hidden', position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { position: 'absolute', top: spacing.x3, left: spacing.x3, right: spacing.x3, flexDirection: 'row', gap: spacing.x2, flexWrap: 'wrap' },
  section: { gap: spacing.x2 },
  title: { ...typography.headline, fontSize: 20, lineHeight: 27, fontWeight: '800' },
  metaText: { fontSize: 13, lineHeight: 19 },
  sectionTitle: { ...typography.headline, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: spacing.x2 },
  actionButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: spacing.x1, paddingHorizontal: spacing.x1, borderRadius: radii.compact },
  actionLabel: { fontWeight: '700', fontSize: 12 },
  cardList: { gap: spacing.x3 },
  serviceCard: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.x3, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, gap: spacing.x3 },
  serviceCopy: { flex: 1, minWidth: 0, gap: spacing.x1 },
  serviceTitle: { fontWeight: '700', fontSize: 15, lineHeight: 21 },
  serviceDescription: { fontSize: 12, lineHeight: 18 },
  duration: { fontSize: 12, fontWeight: '700' },
  serviceAction: { alignItems: 'flex-end', gap: spacing.x2 },
  fee: { fontWeight: '900', fontSize: 16 },
  bookButton: { minWidth: 82, minHeight: 38, paddingHorizontal: spacing.x3, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  bookLabel: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  rosterList: { gap: spacing.x2 },
  staffCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.x3, borderRadius: radii.compact, borderWidth: StyleSheet.hairlineWidth, gap: spacing.x3 },
  staffCopy: { flex: 1, minWidth: 0 },
  staffName: { fontWeight: '700', fontSize: 14 },
  staffMeta: { fontSize: 12, lineHeight: 18 },
  stickyFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.x4, paddingTop: spacing.x3, paddingBottom: spacing.x4 },
});
