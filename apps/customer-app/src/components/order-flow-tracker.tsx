import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import type { OrderStatus } from '@/contracts/order-contract.generated';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACTIVE_STEPS = [
  { status: 'PLACED', label: 'Order placed' },
  { status: 'ACCEPTED', label: 'Merchant accepted' },
  { status: 'PREPARING', label: 'Merchant preparing' },
  { status: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { status: 'ASSIGNED', label: 'Captain assigned' },
  { status: 'PICKED_UP', label: 'Picked up' },
  { status: 'DELIVERED', label: 'Delivered' },
  { status: 'COMPLETED', label: 'Completed' },
] as const satisfies ReadonlyArray<{ status: OrderStatus; label: string }>;

const TERMINAL_LABELS: Partial<Record<OrderStatus, string>> = {
  REJECTED: 'Merchant rejected',
  CANCELLED: 'Order cancelled',
};

export function OrderFlowTracker({ status }: { status: OrderStatus }) {
  const theme = useTheme();
  const currentIndex = ACTIVE_STEPS.findIndex((step) => step.status === status);
  const terminalLabel = TERMINAL_LABELS[status];

  return (
    <View style={styles.container}>
      {ACTIVE_STEPS.map((step, index) => {
        const done = currentIndex >= 0 && index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step.status} style={styles.row}>
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
              {step.label}
            </ThemedText>
          </View>
        );
      })}
      {terminalLabel ? (
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: theme.danger, borderColor: theme.danger }]}>
            <AppIcon name="close" color="#FFFFFF" size={12} />
          </View>
          <ThemedText type="small" style={{ fontWeight: '900', color: theme.danger }}>{terminalLabel}</ThemedText>
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
