import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { AppBar, FilterChip, PrimaryAction, StateView, StatusBadge } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useAppointments } from '@/hooks/use-appointments';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import type { CustomerAppointmentRecord } from '@/services/customer-history';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function appointmentIcon(record: CustomerAppointmentRecord): AppIconName {
  const value = `${record.serviceName} ${record.providerName}`.toLowerCase();
  if (value.includes('groom') || value.includes('spa')) return 'groom';
  return 'medical';
}

function formatAppointmentDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatAppointmentTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function AppointmentsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { requireAuth } = useAuthIntent();

  const {
    user,
    session,
    filteredAppointments,
    state,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    actionLoading,
    reload,
    cancel,
    submitReview,
  } = useAppointments();

  const [selectedApptForReview, setSelectedApptForReview] = useState<CustomerAppointmentRecord | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [selectedApptForCancel, setSelectedApptForCancel] = useState<CustomerAppointmentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title={t('routes.appointments')} subtitle="Manage your pet visits" />}>
        <StateView
          kind="unauthenticated"
          title={t('states.unauthenticated')}
          message="Sign in to view your appointment history."
          actionLabel={t('common.signIn')}
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/appointments' })}
        />
      </ScreenShell>
    );
  }

  const handleCancelSubmit = async () => {
    if (!selectedApptForCancel) return;
    try {
      await cancel(selectedApptForCancel.id, cancelReason.trim() || 'Cancelled by customer');
      setSelectedApptForCancel(null);
      setCancelReason('');
      Alert.alert(t('common.success'), 'Appointment cancelled successfully.');
    } catch (error: unknown) {
      Alert.alert(t('common.error'), errorMessage(error, 'Could not cancel appointment.'));
    }
  };

  const handleReviewSubmit = async () => {
    if (!selectedApptForReview) return;
    try {
      const result = await submitReview({
        providerId: selectedApptForReview.providerId,
        targetId: selectedApptForReview.id,
        rating,
        comment: comment.trim(),
      });

      setSelectedApptForReview(null);
      setComment('');
      setRating(5);
      if (result === 'duplicate') {
        Alert.alert(t('explore.alreadyReviewed'), t('explore.alreadyReviewedBody'));
      } else {
        Alert.alert(t('explore.thankYou'), t('explore.reviewSubmitted'));
      }
    } catch (error: unknown) {
      Alert.alert(t('common.error'), errorMessage(error, 'Could not submit review.'));
    }
  };

  const openDirections = (address?: string) => {
    if (!address) return;
    void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(address)}`).catch(() => null);
  };

  const callProvider = (phone?: string) => {
    if (!phone) return;
    void Linking.openURL(`tel:${phone}`).catch(() => null);
  };

  return (
    <ScreenShell
      header={<AppBar title={t('routes.appointments')} subtitle="Manage upcoming vet and grooming visits" />}
      testID="appointments-screen"
    >
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          <FilterChip label="Upcoming" selected={activeTab === 'upcoming'} onPress={() => setActiveTab('upcoming')} />
          <FilterChip label="Past visits" selected={activeTab === 'past'} onPress={() => setActiveTab('past')} />
          <FilterChip label="Cancelled" selected={activeTab === 'cancelled'} onPress={() => setActiveTab('cancelled')} />
        </ScrollView>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <AppIcon name="search" size={18} color={theme.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search clinic, service, or pet…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            accessibilityLabel="Search appointments"
            returnKeyType="search"
            maxFontSizeMultiplier={1.6}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear appointment search"
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <AppIcon name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {state === 'loading' || state === 'idle' ? (
        <StateView kind="loading" title={t('states.loading')} message={t('states.loadingMessage')} />
      ) : null}
      {state === 'offline' ? (
        <StateView
          kind="offline"
          title={t('states.offline')}
          message={t('states.offlineMessage')}
          actionLabel={t('states.retry')}
          onAction={() => void reload()}
        />
      ) : null}
      {state === 'error' ? (
        <StateView
          kind="error"
          title={t('states.error')}
          message="Could not load appointments."
          actionLabel={t('states.retry')}
          onAction={() => void reload()}
        />
      ) : null}
      {state === 'ready' && filteredAppointments.length === 0 ? (
        <StateView
          kind="empty"
          title={searchQuery ? 'No matching appointments' : `No ${activeTab} appointments`}
          message={searchQuery ? 'Try a different clinic, service, or pet name.' : 'Your pet visits will appear here.'}
          actionLabel={searchQuery ? 'Clear search' : undefined}
          onAction={searchQuery ? () => setSearchQuery('') : undefined}
        />
      ) : null}

      {state === 'ready' && filteredAppointments.length > 0 ? (
        <View style={styles.list}>
          {filteredAppointments.map((appt) => {
            const isUpcoming = ['SLOT_HELD', 'CONFIRMED'].includes(appt.status);
            const isCompleted = appt.status === 'COMPLETED';
            const isCancelled = ['CANCELLED', 'EXPIRED'].includes(appt.status);
            const accentColor = isCompleted
              ? theme.success
              : isCancelled
                ? theme.textSecondary
                : appt.status === 'CONFIRMED'
                  ? theme.success
                  : theme.warning;

            return (
              <View
                key={appt.id}
                style={[
                  styles.card,
                  shadows.card,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderLeftColor: accentColor,
                  },
                ]}
                accessible
                accessibilityLabel={`${appt.serviceName} for ${appt.petName} at ${appt.providerName}. ${formatAppointmentDate(appt.slotStartsAt)}. Status ${appt.status}.`}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.serviceIcon, { backgroundColor: theme.primarySoft }]}>
                    <AppIcon name={appointmentIcon(appt)} size={24} color={theme.primary} />
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={styles.serviceName}>{appt.serviceName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {appt.providerName} · {appt.petName}
                    </ThemedText>
                  </View>
                  <StatusBadge
                    label={appt.status.replaceAll('_', ' ')}
                    tone={
                      appt.status === 'CONFIRMED' || appt.status === 'COMPLETED'
                        ? 'success'
                        : appt.status === 'CANCELLED' || appt.status === 'EXPIRED'
                          ? 'error'
                          : 'warning'
                    }
                  />
                </View>

                <View style={[styles.schedulePanel, { backgroundColor: theme.muted }]}>
                  <View style={styles.infoRow}>
                    <AppIcon name="calendar" size={18} color={theme.textSecondary} />
                    <ThemedText style={styles.scheduleText}>{formatAppointmentDate(appt.slotStartsAt)}</ThemedText>
                  </View>
                  <View style={styles.infoRow}>
                    <AppIcon name="clock" size={18} color={theme.textSecondary} />
                    <ThemedText style={styles.scheduleText}>{formatAppointmentTime(appt.slotStartsAt)}</ThemedText>
                  </View>
                </View>

                {appt.address ? (
                  <View style={styles.infoRow}>
                    <AppIcon name="location" size={17} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.flex}>
                      {appt.address}
                    </ThemedText>
                  </View>
                ) : null}

                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryCardAction,
                      { backgroundColor: theme.primarySoft },
                      pressed && styles.pressed,
                    ]}
                    onPress={() => router.push(`/appointments/${appt.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={isUpcoming ? `Reschedule ${appt.serviceName}` : `View ${appt.serviceName} details`}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>
                      {isUpcoming ? 'Reschedule' : 'View details'}
                    </ThemedText>
                  </Pressable>

                  {appt.address ? (
                    <Pressable
                      style={({ pressed }) => [styles.iconAction, { borderColor: theme.border }, pressed && styles.pressed]}
                      onPress={() => openDirections(appt.address)}
                      accessibilityRole="button"
                      accessibilityLabel={`Directions to ${appt.providerName}`}
                    >
                      <AppIcon name="location" size={19} color={theme.primary} />
                    </Pressable>
                  ) : null}

                  {appt.providerPhone ? (
                    <Pressable
                      style={({ pressed }) => [styles.iconAction, { borderColor: theme.border }, pressed && styles.pressed]}
                      onPress={() => callProvider(appt.providerPhone)}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${appt.providerName}`}
                    >
                      <AppIcon name="phone" size={19} color={theme.primary} />
                    </Pressable>
                  ) : null}

                  {isUpcoming ? (
                    <Pressable
                      style={({ pressed }) => [styles.iconAction, { borderColor: theme.border }, pressed && styles.pressed]}
                      onPress={() => setSelectedApptForCancel(appt)}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel ${appt.serviceName}`}
                    >
                      <AppIcon name="close" size={20} color={theme.danger} />
                    </Pressable>
                  ) : null}

                  {isCompleted && !appt.hasReview ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.reviewAction,
                        { backgroundColor: theme.accentSoft },
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setSelectedApptForReview(appt)}
                      accessibilityRole="button"
                      accessibilityLabel={`Review ${appt.providerName}`}
                    >
                      <AppIcon name="star" size={17} color={theme.accent} />
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>
                        Review
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Modal
        visible={Boolean(selectedApptForReview)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedApptForReview(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityViewIsModal
          >
            <ThemedText type="title">Leave a review</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Rate your visit to {selectedApptForReview?.providerName}
            </ThemedText>

            <View style={styles.starRow} accessibilityRole="adjustable" accessibilityValue={{ min: 1, max: 5, now: rating }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  onPress={() => setRating(star)}
                  accessibilityRole="button"
                  accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: star === rating }}
                  style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                >
                  <AppIcon name="star" size={28} color={star <= rating ? theme.accent : theme.border} />
                </Pressable>
              ))}
            </View>

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Share your experience (optional)…"
              placeholderTextColor={theme.textSecondary}
              style={[styles.reasonInput, { color: theme.text, borderColor: theme.border }]}
              multiline
              accessibilityLabel="Review comment"
              maxFontSizeMultiplier={1.6}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalSecondary, pressed && styles.pressed]}
                onPress={() => setSelectedApptForReview(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel review"
              >
                <ThemedText type="smallBold" themeColor="textSecondary">Cancel</ThemedText>
              </Pressable>
              <PrimaryAction label="Submit review" onPress={() => void handleReviewSubmit()} loading={actionLoading} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectedApptForCancel)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedApptForCancel(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityViewIsModal
          >
            <ThemedText type="title">Cancel appointment</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Cancel {selectedApptForCancel?.serviceName} for {selectedApptForCancel?.petName}?
            </ThemedText>

            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Reason for cancellation…"
              placeholderTextColor={theme.textSecondary}
              style={[styles.reasonInput, { color: theme.text, borderColor: theme.border }]}
              multiline
              accessibilityLabel="Cancellation reason"
              maxFontSizeMultiplier={1.6}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalSecondary, pressed && styles.pressed]}
                onPress={() => setSelectedApptForCancel(null)}
                accessibilityRole="button"
                accessibilityLabel="Keep appointment"
              >
                <ThemedText type="smallBold" themeColor="textSecondary">Keep appointment</ThemedText>
              </Pressable>
              <PrimaryAction label="Confirm cancellation" onPress={() => void handleCancelSubmit()} loading={actionLoading} />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: spacing.x4, gap: spacing.x3, marginBottom: spacing.x3 },
  tabsScroll: { flexDirection: 'row', gap: spacing.x2, paddingRight: spacing.x4 },
  searchBox: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderRadius: radii.compact,
    paddingLeft: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  searchInput: { flex: 1, minHeight: touchTarget, ...typography.body, paddingVertical: 0 },
  clearButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x6 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 5,
    borderRadius: radii.card,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.x3 },
  serviceIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  serviceName: { ...typography.title, fontSize: 18, lineHeight: 24 },
  schedulePanel: { borderRadius: radii.compact, padding: spacing.x3, gap: spacing.x2 },
  scheduleText: { ...typography.label, flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2, alignItems: 'center' },
  primaryCardAction: {
    minHeight: touchTarget,
    flexGrow: 1,
    minWidth: 150,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
  },
  iconAction: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAction: {
    minHeight: touchTarget,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x1,
  },
  starRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: spacing.x2 },
  starButton: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11,28,48,0.52)', justifyContent: 'center', padding: spacing.x4 },
  modalBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x6, gap: spacing.x3 },
  reasonInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radii.compact,
    padding: spacing.x3,
    textAlignVertical: 'top',
    ...typography.body,
  },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.x2 },
  modalSecondary: { minHeight: touchTarget, paddingHorizontal: spacing.x3, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.82 },
});
