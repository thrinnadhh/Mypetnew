import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CustomerProductFulfilmentMode, CustomerProductOrderStatus } from '@/services/customer-order-list';

type TimelineKey = CustomerProductOrderStatus | 'CAPTAIN_ASSIGNED';
type HistoryEntry = { toStatus: CustomerProductOrderStatus };

type Step = { key: TimelineKey; label: string };

const PICKUP_STEPS: Step[] = [
  { key: 'PLACED', label: 'Order placed' },
  { key: 'ACCEPTED', label: 'Merchant accepted' },
  { key: 'PREPARING', label: 'Merchant preparing' },
  { key: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { key: 'PICKED_UP', label: 'Picked up' },
  { key: 'DELIVERED', label: 'Completed' },
];

const DELIVERY_STEPS: Step[] = [
  { key: 'PLACED', label: 'Order placed' },
  { key: 'ACCEPTED', label: 'Merchant accepted' },
  { key: 'PREPARING', label: 'Merchant preparing' },
  { key: 'READY_FOR_PICKUP', label: 'Ready for Captain' },
  { key: 'CAPTAIN_ASSIGNED', label: 'Captain assigned' },
  { key: 'PICKED_UP', label: 'Picked up for delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
];

const TERMINAL_LABELS: Partial<Record<CustomerProductOrderStatus, string>> = {
  REJECTED: 'Merchant rejected',
  CANCELLED: 'Order cancelled',
};

function currentTimelineKey(
  status: CustomerProductOrderStatus,
  fulfilmentMode: CustomerProductFulfilmentMode,
  deliveryStatus?: string | null,
): TimelineKey | null {
  if (status === 'CANCELLED' || status === 'REJECTED') return null;
  if (
    fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' &&
    status === 'READY_FOR_PICKUP' &&
    ['ASSIGNED', 'PICKED_UP', 'DELIVERED'].includes(deliveryStatus ?? '')
  ) {
    return 'CAPTAIN_ASSIGNED';
  }
  return status;
}

export function OrderFlowTracker({
  status,
  fulfilmentMode,
  deliveryStatus,
  statusHistory,
}: {
  status: CustomerProductOrderStatus;
  fulfilmentMode: CustomerProductFulfilmentMode;
  deliveryStatus?: string | null;
  statusHistory: HistoryEntry[];
}) {
  const theme = useTheme();
  const steps = fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY' ? DELIVERY_STEPS : PICKUP_STEPS;
  const currentKey = currentTimelineKey(status, fulfilmentMode, deliveryStatus);
  const currentIndex = currentKey ? steps.findIndex((step) => step.key === currentKey) : -1;
  const historicalProgress = statusHistory.reduce((highest, entry) => {
    const index = steps.findIndex((step) => step.key === entry.toStatus);
    return Math.max(highest, index);
  }, -1);
  const completedThrough = currentIndex >= 0 ? currentIndex : historicalProgress;
  const terminalLabel = TERMINAL_LABELS[status];
  const spoken = [
    ...steps.map((step, index) => `${step.label}: ${index < completedThrough ? 'completed' : index === completedThrough && !terminalLabel ? 'current' : 'upcoming'}`),
    terminalLabel ? `${terminalLabel}: current` : null,
  ].filter(Boolean).join('. ');

  return (
    <View style={styles.container} accessible accessibilityLabel={spoken}>
      {steps.map((step, index) => {
        const done = index < completedThrough || (!terminalLabel && index === completedThrough);
        const active = !terminalLabel && index === completedThrough;
        return (
          <View key={step.key} style={styles.row}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: done ? theme.primary : theme.muted,
                  borderColor: active ? theme.primary : theme.border,
                },
              ]}
            >
              {done ? <AppIcon name="check" color="#FFFFFF" size={12} /> : null}
            </View>
            <ThemedText
              type="small"
              style={{ fontWeight: active ? '900' : '600', color: done ? theme.text : theme.textSecondary }}
            >
              {step.label}{active ? ' · Current' : ''}
            </ThemedText>
          </View>
        );
      })}
      {terminalLabel ? (
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: theme.danger, borderColor: theme.danger }]}>
            <AppIcon name="close" color="#FFFFFF" size={12} />
          </View>
          <ThemedText type="small" style={{ fontWeight: '900', color: theme.danger }}>{terminalLabel} · Current</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
