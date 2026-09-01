import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
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

export interface AppointmentCardProps {
  appointment: MerchantAppointmentRequest;
  availableTargets: MerchantAppointmentStatus[];
  onTransition: (appointment: MerchantAppointmentRequest, target: MerchantAppointmentStatus) => void;
  onViewDetails?: (appointment: MerchantAppointmentRequest) => void;
  busy?: boolean;
  offline?: boolean;
  navigated?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function AppointmentCard({
  appointment,
  availableTargets,
  onTransition,
  onViewDetails,
  busy = false,
  offline = false,
  navigated = false,
  style,
  testID,
}: AppointmentCardProps) {
  const isHighPriority = appointment.status === 'BOOKED';
  const category = serviceCategoryFromServiceName(appointment.serviceName);
  const isGrooming = category === 'Grooming';

  // Primary action candidates: ACCEPT (CONFIRMED), CHECK_IN, IN_SERVICE, COMPLETE
  const primaryAction = availableTargets.find(
    (t) => t === 'CONFIRMED' || t === 'CHECKED_IN' || t === 'IN_SERVICE' || t === 'COMPLETED',
  );

  // Destructive action candidates: REJECTED, CANCELLED
  const destructiveAction = availableTargets.find(
    (t) => t === 'REJECTED' || t === 'CANCELLED',
  );

  const durationMinutes = Math.max(
    0,
    Math.round(
      (new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000,
    ),
  );

  return (
    <View
      style={[
        styles.card,
        isHighPriority && styles.cardHighPriority,
        navigated && styles.cardNavigated,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Appointment for ${appointment.petName}, service ${appointment.serviceName}, status ${appointmentStatusLabel(appointment.status)}, time ${formatAppointmentSchedule(appointment.startsAt)}`}
      testID={testID}
    >
      {/* Header Row: Category Pill, Service & Pet, StatusBadge */}
      <View style={styles.headerRow}>
        <View style={styles.serviceInfo}>
          <View style={styles.categoryRow}>
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
            {durationMinutes > 0 ? (
              <View style={styles.durationPill}>
                <Text style={styles.durationText}>{durationMinutes}m</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.serviceName}>{appointment.serviceName}</Text>
          <Text style={styles.petName}>
            Pet: <Text style={styles.petNameHighlight}>{appointment.petName}</Text>
          </Text>
        </View>

        <StatusBadge
          label={appointmentStatusLabel(appointment.status)}
          variant={appointmentStatusVariant(appointment.status)}
          testID={testID ? `${testID}-status-badge` : undefined}
        />
      </View>

      {/* Schedule Time Row */}
      <View style={styles.scheduleRow}>
        <Text style={styles.scheduleIcon}>📅</Text>
        <Text style={styles.scheduleText}>
          {formatAppointmentSchedule(appointment.startsAt, appointment.endsAt)}
        </Text>
      </View>

      {/* Customer Note Preview if present */}
      {appointment.notes ? (
        <View style={styles.notesBox}>
          <Text style={styles.notesIcon}>💬</Text>
          <Text style={styles.notesText} numberOfLines={2}>
            {appointment.notes}
          </Text>
        </View>
      ) : null}

      {/* Meta Row: Payment Status & Total Price */}
      <View style={styles.metaRow}>
        <View style={styles.paymentGroup}>
          <StatusBadge
            label={formatPaymentStatusLabel(appointment.paymentMethod, appointment.paymentStatus)}
            variant={formatPaymentStatusVariant(appointment.paymentMethod, appointment.paymentStatus)}
            testID={testID ? `${testID}-payment-badge` : undefined}
          />
        </View>

        <Text style={styles.priceText}>{formatAppointmentPrice(appointment.pricePaise)}</Text>
      </View>

      {/* Actions Row */}
      <View style={styles.actionsRow}>
        {onViewDetails ? (
          <SecondaryButton
            title="Details"
            onPress={() => onViewDetails(appointment)}
            disabled={busy}
            style={styles.detailBtn}
            testID={testID ? `${testID}-details-btn` : undefined}
          />
        ) : null}

        {destructiveAction ? (
          <SecondaryButton
            title={appointmentActionTitle(destructiveAction)}
            onPress={() => onTransition(appointment, destructiveAction)}
            disabled={busy || offline}
            style={styles.destructiveBtn}
            testID={testID ? `${testID}-action-${destructiveAction}` : undefined}
          />
        ) : null}

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
            testID={testID ? `${testID}-action-${primaryAction}` : undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.cardPadding,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHighPriority: {
    borderColor: colors.warning,
    borderLeftWidth: 4,
    backgroundColor: '#fffdfa',
  },
  cardNavigated: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  serviceInfo: {
    flex: 1,
    gap: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
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
    fontSize: 11,
  },
  categoryText: {
    ...typography.labelSm,
    fontSize: 11,
    fontWeight: '700',
  },
  groomingText: {
    color: '#15803d',
  },
  vetText: {
    color: '#1d4ed8',
  },
  durationPill: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.slate100,
  },
  durationText: {
    ...typography.labelSm,
    fontSize: 11,
    color: colors.slate600,
    fontWeight: '600',
  },
  serviceName: {
    ...typography.headlineSm,
    color: colors.slate900,
    fontWeight: '800',
  },
  petName: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  petNameHighlight: {
    color: colors.slate900,
    fontWeight: '700',
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  scheduleIcon: {
    fontSize: 14,
  },
  scheduleText: {
    ...typography.bodyMd,
    color: colors.slate800,
    fontWeight: '600',
  },
  notesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    padding: spacing.xs + 2,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  notesIcon: {
    fontSize: 13,
    marginTop: 1,
  },
  notesText: {
    flex: 1,
    ...typography.bodySm,
    color: colors.slate700,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  paymentGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  priceText: {
    ...typography.labelLg,
    color: colors.slate900,
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  detailBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
  },
  destructiveBtn: {
    flex: 1.2,
    minHeight: spacing.touchTargetMin,
    borderColor: '#fca5a5',
    backgroundColor: '#fff1f2',
  },
  primaryBtn: {
    flex: 2,
    minHeight: spacing.touchTargetMin,
  },
  successBtn: {
    backgroundColor: colors.success,
  },
});
