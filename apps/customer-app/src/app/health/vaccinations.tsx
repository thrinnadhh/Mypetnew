import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { radii, shadows, spacing, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const PETS = [
  { id: 'pet-bruno', name: 'Bruno (Golden Retriever)', progress: 80, completedCount: 4, totalCount: 5 },
  { id: 'pet-luna', name: 'Luna (Persian Cat)', progress: 100, completedCount: 3, totalCount: 3 },
];

const VACCINATION_RECORDS = [
  {
    id: 'vac-1',
    petId: 'pet-bruno',
    name: 'Annual Rabies Booster Vaccine',
    type: 'VACCINE',
    status: 'UPCOMING',
    dueDate: '2026-08-15',
    daysLeft: 'Due in 16 days',
    clinic: 'City Pet Hospital Tirupati',
    doctor: 'Dr. K. Srinivas',
  },
  {
    id: 'vac-2',
    petId: 'pet-bruno',
    name: 'Drontal Plus Deworming Tablet',
    type: 'TABLET',
    status: 'OVERDUE',
    dueDate: '2026-07-27',
    daysLeft: 'Overdue by 3 days',
    clinic: 'PetCare & Wellness Hospital',
    doctor: 'Dr. Ananya Rao',
  },
  {
    id: 'vac-3',
    petId: 'pet-bruno',
    name: 'DHPPi Core 7-in-1 Combination Vaccine',
    type: 'VACCINE',
    status: 'COMPLETED',
    dueDate: '2026-01-10',
    daysLeft: 'Given on Jan 10, 2026',
    clinic: 'City Pet Hospital Tirupati',
    doctor: 'Dr. K. Srinivas',
  },
  {
    id: 'vac-4',
    petId: 'pet-luna',
    name: 'Feline Tri-Cat Vaccine Booster',
    type: 'VACCINE',
    status: 'COMPLETED',
    dueDate: '2026-03-20',
    daysLeft: 'Given on Mar 20, 2026',
    clinic: 'City Pet Hospital Tirupati',
    doctor: 'Dr. Priya Sharma',
  },
];

export default function VaccinationsScreen() {
  const router = useRouter();
  const theme = useTheme();

  const [selectedPetId, setSelectedPetId] = useState<string>('pet-bruno');
  const activePet = PETS.find((p) => p.id === selectedPetId) ?? PETS[0];

  const petRecords = VACCINATION_RECORDS.filter((r) => r.petId === selectedPetId);
  const overdueRecords = petRecords.filter((r) => r.status === 'OVERDUE');
  const upcomingRecords = petRecords.filter((r) => r.status === 'UPCOMING');
  const historyRecords = petRecords.filter((r) => r.status === 'COMPLETED');

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Vaccinations & Tablets" subtitle="Track health schedules & immunization" />

      {/* Pet Switcher Bar */}
      <View style={styles.petBar}>
        <ThemedText style={{ fontSize: 13, color: theme.textSecondary, fontWeight: '600' }}>Select Pet:</ThemedText>
        <View style={{ flexDirection: 'row', gap: spacing.x2 }}>
          {PETS.map((pet) => (
            <FilterChip
              key={pet.id}
              label={pet.name}
              selected={selectedPetId === pet.id}
              onPress={() => setSelectedPetId(pet.id)}
            />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Health Status & Progress Card */}
        <View style={[styles.progressCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.rowBetween}>
            <View>
              <ThemedText style={[styles.cardTitle, { color: theme.text }]}>Immunization Status</ThemedText>
              <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
                {activePet.completedCount} of {activePet.totalCount} Core Vaccines & Deworming Done
              </ThemedText>
            </View>
            <StatusBadge label={`${activePet.progress}% Protected`} color={activePet.progress === 100 ? theme.success : theme.warning} />
          </View>

          {/* Progress Bar */}
          <View style={[styles.progressBarTrack, { backgroundColor: theme.muted }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${activePet.progress}%`, backgroundColor: activePet.progress === 100 ? theme.success : theme.primary },
              ]}
            />
          </View>
        </View>

        {/* Overdue / Action Required Section */}
        {overdueRecords.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.danger }]}>🚨 Overdue / Action Required</ThemedText>
            {overdueRecords.map((item) => (
              <View
                key={item.id}
                style={[styles.recordCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.danger }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <StatusBadge label={item.daysLeft} color={theme.danger} />
                  <ThemedText style={{ fontWeight: '700', fontSize: 15, color: theme.text }}>{item.name}</ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>🏥 {item.clinic}</ThemedText>
                </View>
                <PrimaryButton
                  label="Book Vet Now"
                  onPress={() => router.push('/hospital/city-pet-hospital' as never)}
                />
              </View>
            ))}
          </View>
        )}

        {/* Upcoming Section */}
        {upcomingRecords.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>📅 Upcoming Schedules</ThemedText>
            {upcomingRecords.map((item) => (
              <View
                key={item.id}
                style={[styles.recordCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <StatusBadge label={item.daysLeft} color={theme.primary} />
                  <ThemedText style={{ fontWeight: '700', fontSize: 15, color: theme.text }}>{item.name}</ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>🏥 {item.clinic} • {item.doctor}</ThemedText>
                </View>
                <PrimaryButton
                  label="Book Slot"
                  onPress={() => router.push('/hospital/city-pet-hospital' as never)}
                />
              </View>
            ))}
          </View>
        )}

        {/* Completed History Section */}
        {historyRecords.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>✓ Completed History</ThemedText>
            {historyRecords.map((item) => (
              <View
                key={item.id}
                style={[styles.recordCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              >
                <AppIcon name="sparkle" color={theme.success} size={24} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700', fontSize: 14, color: theme.text }}>{item.name}</ThemedText>
                  <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>{item.daysLeft} • {item.clinic}</ThemedText>
                </View>
                <StatusBadge label="Verified" color={theme.success} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.x3 },
  petBar: { gap: spacing.x1, marginBottom: spacing.x3 },
  scrollContent: { gap: spacing.x4, paddingBottom: spacing.x6 },
  progressCard: { padding: spacing.x4, borderRadius: radii.card, borderWidth: 1, gap: spacing.x3 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...typography.headline, fontSize: 16, fontWeight: '700' },
  progressBarTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 5 },
  section: { gap: spacing.x2 },
  sectionTitle: { ...typography.headline, fontSize: 16, fontWeight: '700' },
  recordCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.x3, borderRadius: radii.card, borderWidth: 1, gap: spacing.x3 },
});
