import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

export type StatusType =
  | 'NEW_REQUEST'
  | 'CONFIRMED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'PAID_ONLINE'
  | 'PAY_AT_CLINIC'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'IN_STOCK'
  | 'VIEW_ONLY_MEDICINE'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  style?: ViewStyle;
}

const STATUS_CONFIG: Record<StatusType, { bg: string; text: string; defaultLabel: string }> = {
  NEW_REQUEST: { bg: palette.amberSoft, text: '#92400E', defaultLabel: 'NEW REQUEST' },
  CONFIRMED: { bg: palette.emeraldSoft, text: '#065F46', defaultLabel: 'CONFIRMED' },
  IN_SERVICE: { bg: palette.royalBlueSoft, text: palette.royalBlue, defaultLabel: 'IN SERVICE' },
  COMPLETED: { bg: '#F1F5F9', text: '#475569', defaultLabel: 'COMPLETED' },
  CANCELLED: { bg: palette.errorSoft, text: palette.error, defaultLabel: 'CANCELLED' },
  REJECTED: { bg: palette.errorSoft, text: palette.error, defaultLabel: 'REJECTED' },
  PAID_ONLINE: { bg: palette.emeraldSoft, text: '#065F46', defaultLabel: 'PAID ONLINE' },
  PAY_AT_CLINIC: { bg: '#F1F5F9', text: palette.inkMuted, defaultLabel: 'PAY AT CLINIC' },
  LOW_STOCK: { bg: palette.amberSoft, text: '#92400E', defaultLabel: 'LOW STOCK' },
  OUT_OF_STOCK: { bg: palette.errorSoft, text: palette.error, defaultLabel: 'OUT OF STOCK' },
  IN_STOCK: { bg: palette.emeraldSoft, text: '#065F46', defaultLabel: 'IN STOCK' },
  VIEW_ONLY_MEDICINE: { bg: '#E2E8F0', text: '#334155', defaultLabel: 'VIEW ONLY' },
  PREPARING: { bg: palette.amberSoft, text: '#92400E', defaultLabel: 'PREPARING' },
  READY_FOR_PICKUP: { bg: palette.emeraldSoft, text: '#065F46', defaultLabel: 'READY FOR PICKUP' },
  OUT_FOR_DELIVERY: { bg: palette.royalBlueSoft, text: palette.royalBlue, defaultLabel: 'OUT FOR DELIVERY' },
};

export function StatusBadge({ status, label, style }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    bg: '#F1F5F9',
    text: palette.inkMuted,
    defaultLabel: String(status),
  };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, style]}>
      <Text style={[styles.badgeText, { color: config.text }]}>
        {label ?? config.defaultLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
});
