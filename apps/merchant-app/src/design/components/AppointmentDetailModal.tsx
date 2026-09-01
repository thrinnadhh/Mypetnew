import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  MerchantAppointmentRequest,
  MerchantAppointmentStatus,
} from '../../appointments/api';
import {
  appointmentActionTitle,
  appointmentStatusLabel,
  appointmentStatusVariant,
  formatAppointmentPrice,
  formatAppointmentSchedule,
  formatPaymentStatusLabel,
  formatPaymentStatusVariant,
  serviceCategoryFromServiceName,
} from '../../appointments/model';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { StatusBadge } from './StatusBadge';

export interface AppointmentDetailModalProps {
  visible: boolean;
  appointment: MerchantAppointmentRequest | null;
  availableTargets: MerchantAppointmentStatus[];
  onClose: () => void;
  onTransition: (appointment: MerchantAppointmentRequest, target: MerchantAppointmentStatus) => void;
  busy?: boolean;
  offline?: boolean;
  testID?: string;
}

export function AppointmentDetailModal({
  visible,
  appointment,
  availableTargets,
  onClose,
  onTransition,
  busy = false,
  offline = false,
  testID,
}: AppointmentDetailModalProps) {
  if (!appointment) return null;

  const category = serviceCategoryFromServiceName(appointment.serviceName);
  const isGrooming = category === 'Grooming';

  // Primary actions: CONFIRMED, CHECKED_IN, IN_SERVICE, COMPLETED
  const primaryAction = availableTargets.find(
    (t) => t === 'CONFIRMED' || t === 'CHECKED_IN' || t === 'IN_SERVICE' || t === 'COMPLETED',
  );

  const destructiveActions = availableTargets.filter(
    (t) => t === 'REJECTED' || t === 'CANCELLED' || t === 'NO_SHOW',
  );

  const durationMinutes = Math.max(
    0,
    Math.round(
      (new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000,
    ),
  );

  const shortRef = `#APT-${appointment.appointmentId.slice(0, 8).toUpperCase()}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.title}>{shortRef}</Text>
              <Text style={styles.subtitle}>
                Booked on {new Date(appointment.createdAt).toLocaleString('en-IN')}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close appointment details"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Status & Service Category Banner */}
            <View style={styles.statusSection}>
              <View style={styles.statusRow}>
                <Text style={styles.sectionLabel}>Appointment Status</Text>
                <StatusBadge
                  label={appointmentStatusLabel(appointment.status)}
                  variant={appointmentStatusVariant(appointment.status)}
                  testID="modal-status-badge"
                />
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.sectionLabel}>Service Category</Text>
                <View
                  style={[
                    styles.categoryPill,
                    isGrooming ? styles.groomingPill : styles.vetPill,
                  ]}
                >
                  <Text style={styles.categoryIcon}>{isGrooming ? '✂️' : '🩺'}</Text>
                  <Text
                    style={[
                      styles.categoryText,
                      isGrooming ? styles.groomingText : styles.vetText,
                    ]}
                  >
                    {category}
                  </Text>
                </View>
              </View>
            </View>

            {/* Service & Schedule Information */}
            <View style={styles.detailsCard}>
              <Text style={styles.cardHeader}>Service & Schedule</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Service</Text>
                <Text style={styles.metaValueHighlight}>{appointment.serviceName}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Scheduled Time</Text>
                <Text style={styles.metaValue}>
                  {formatAppointmentSchedule(appointment.startsAt, appointment.endsAt)}
                </Text>
              </View>
              {durationMinutes > 0 ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Estimated Duration</Text>
                  <Text style={styles.metaValue}>{durationMinutes} minutes</Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Outlet Scope</Text>
                <Text style={styles.metaValueCode} numberOfLines={1}>
                  {appointment.outletId}
                </Text>
              </View>
            </View>

            {/* Pet & Customer Information */}
            <View style={styles.detailsCard}>
              <Text style={styles.cardHeader}>Pet & Customer Context</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Pet Name</Text>
                <Text style={styles.metaValueHighlight}>{appointment.petName}</Text>
              </View>
              {appointment.notes ? (
                <View style={styles.notesContainer}>
                  <Text style={styles.notesLabel}>Customer Instructions:</Text>
                  <Text style={styles.notesBody}>{appointment.notes}</Text>
                </View>
              ) : (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Customer Notes</Text>
                  <Text style={styles.metaValueMuted}>No special instructions provided</Text>
                </View>
              )}
            </View>

            {/* Payment & Settlement Summary */}
            <View style={styles.detailsCard}>
              <Text style={styles.cardHeader}>Payment & Settlement</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Payment Mode</Text>
                <Text style={styles.metaValue}>
                  {appointment.paymentMethod === 'ONLINE_PAYMENT' ? 'Online Payment' : 'Pay at Provider'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Payment Status</Text>
                <StatusBadge
                  label={formatPaymentStatusLabel(appointment.paymentMethod, appointment.paymentStatus)}
                  variant={formatPaymentStatusVariant(appointment.paymentMethod, appointment.paymentStatus)}
                />
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Total Fee</Text>
                <Text style={styles.totalPriceValue}>
                  {formatAppointmentPrice(appointment.pricePaise)}
                </Text>
              </View>
              <Text style={styles.footnote}>
                Authorized by backend commerce settlement & appointment rules.
              </Text>
            </View>

            {/* Offline Alert if disconnected */}
            {offline ? (
              <View style={styles.offlineAlert}>
                <Text style={styles.offlineAlertText}>
                  Offline: Showing cached last known server state. Reconnect to make appointment transitions.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Action Bar Footer */}
          {availableTargets.length > 0 ? (
            <View style={styles.footerActions}>
              {destructiveActions.map((target) => (
                <SecondaryButton
                  key={target}
                  title={appointmentActionTitle(target)}
                  onPress={() => onTransition(appointment, target)}
                  disabled={busy || offline}
                  style={styles.destructiveBtn}
                  testID={`modal-action-${target}`}
                />
              ))}
              {primaryAction ? (
                <PrimaryButton
                  title={appointmentActionTitle(primaryAction)}
                  onPress={() => onTransition(appointment, primaryAction)}
                  loading={busy}
                  disabled={busy || offline}
                  style={[
                    styles.primaryBtn,
                    (primaryAction === 'CONFIRMED' || primaryAction === 'COMPLETED') && styles.successBtn,
                  ]}
                  testID="modal-primary-action-btn"
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.terminalFooter}>
              <Text style={styles.terminalText}>
                No further state transitions available for this appointment.
              </Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  headerTitleGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate500,
  },
  closeBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeText: {
    fontSize: 18,
    color: colors.slate600,
    fontWeight: '700',
  },
  scrollBody: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusSection: {
    backgroundColor: colors.surfaceDim,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    ...typography.labelMd,
    color: colors.slate700,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.base,
    borderRadius: radius.sm,
    gap: 4,
  },
  groomingPill: {
    backgroundColor: '#f0fdf4',
  },
  vetPill: {
    backgroundColor: '#eff6ff',
  },
  categoryIcon: {
    fontSize: 12,
  },
  categoryText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
  groomingText: {
    color: '#15803d',
  },
  vetText: {
    color: '#1d4ed8',
  },
  detailsCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardHeader: {
    ...typography.labelMd,
    color: colors.slate900,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  metaLabel: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  metaValue: {
    ...typography.bodyMd,
    color: colors.slate900,
    fontWeight: '600',
    maxWidth: '65%',
    textAlign: 'right',
  },
  metaValueHighlight: {
    ...typography.labelMd,
    color: colors.slate900,
    fontWeight: '700',
  },
  metaValueCode: {
    ...typography.codeSm,
    color: colors.slate700,
    maxWidth: '60%',
  },
  metaValueMuted: {
    ...typography.bodySm,
    color: colors.slate400,
    fontStyle: 'italic',
  },
  notesContainer: {
    backgroundColor: '#f8fafc',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 2,
  },
  notesLabel: {
    ...typography.labelSm,
    color: colors.slate700,
    fontWeight: '700',
  },
  notesBody: {
    ...typography.bodySm,
    color: colors.slate800,
    lineHeight: 18,
  },
  totalPriceValue: {
    ...typography.headlineSm,
    color: colors.primary,
    fontWeight: '800',
  },
  footnote: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate500,
    marginTop: spacing.xs,
  },
  offlineAlert: {
    backgroundColor: '#fff7ed',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  offlineAlertText: {
    ...typography.bodySm,
    color: '#9a3412',
    fontWeight: '600',
    textAlign: 'center',
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  destructiveBtn: {
    flex: 1,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
  },
  primaryBtn: {
    flex: 2,
  },
  successBtn: {
    backgroundColor: colors.success,
  },
  terminalFooter: {
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.slate50,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  terminalText: {
    ...typography.bodySm,
    color: colors.slate500,
  },
});
