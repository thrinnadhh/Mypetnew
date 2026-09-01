import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface MetricCardProps {
  label: string;
  value: number | string;
  detail: string;
  onPress?: () => void;
  accentColor?: string;
  badgeText?: string;
  style?: ViewStyle;
  testID?: string;
}

export function MetricCard({
  label,
  value,
  detail,
  onPress,
  accentColor = colors.primary,
  badgeText,
  style,
  testID,
}: MetricCardProps) {
  const isActionable = Boolean(onPress);

  return (
    <Pressable
      onPress={onPress}
      disabled={!isActionable}
      style={({ pressed }) => [
        styles.card,
        isActionable && styles.actionable,
        pressed && isActionable && styles.pressed,
        style,
      ]}
      accessibilityRole={isActionable ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${value}. ${detail}`}
      testID={testID}
    >
      <View style={styles.topRow}>
        <Text style={[styles.metricValue, { color: accentColor }]}>{value}</Text>
        {badgeText && (
          <View style={[styles.badge, { backgroundColor: `${accentColor}15` }]}>
            <Text style={[styles.badgeText, { color: accentColor }]}>{badgeText}</Text>
          </View>
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
      {isActionable && (
        <View style={styles.actionRow}>
          <Text style={[styles.actionText, { color: accentColor }]}>View details →</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.cardPadding,
    gap: spacing.base,
    minHeight: 120,
    justifyContent: 'space-between',
  },
  actionable: {
    minHeight: 130,
  },
  pressed: {
    backgroundColor: colors.slate50,
    borderColor: colors.slate400,
    transform: [{ scale: 0.99 }],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  metricValue: {
    ...typography.metricValue,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  badgeText: {
    ...typography.labelSm,
    fontWeight: '800',
  },
  label: {
    ...typography.labelLg,
    color: colors.slate900,
  },
  detail: {
    ...typography.bodySm,
    color: colors.slate600,
    lineHeight: 16,
  },
  actionRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.slate100,
  },
  actionText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
});
