import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'syncing' | 'pending';

export interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  accessibilityLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

export function StatusBadge({
  label,
  variant = 'neutral',
  accessibilityLabel,
  style,
  testID,
}: StatusBadgeProps) {
  const badgeColors = getVariantColors(variant);

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: badgeColors.bg,
          borderColor: badgeColors.border,
        },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <View style={[styles.dot, { backgroundColor: badgeColors.dot }]} />
      <Text style={[styles.label, { color: badgeColors.text }]}>{label}</Text>
    </View>
  );
}

function getVariantColors(variant: StatusVariant) {
  switch (variant) {
    case 'success':
      return {
        bg: colors.successContainer,
        border: '#86efac',
        text: colors.onSuccessContainer,
        dot: colors.success,
      };
    case 'warning':
      return {
        bg: colors.warningContainer,
        border: '#fde68a',
        text: colors.onWarningContainer,
        dot: colors.warning,
      };
    case 'error':
      return {
        bg: colors.errorContainer,
        border: '#fca5a5',
        text: colors.onErrorContainer,
        dot: colors.error,
      };
    case 'info':
      return {
        bg: colors.infoContainer,
        border: '#7dd3fc',
        text: colors.onInfoContainer,
        dot: colors.info,
      };
    case 'syncing':
      return {
        bg: '#eff6ff',
        border: '#bfdbfe',
        text: '#1e40af',
        dot: colors.syncing,
      };
    case 'pending':
      return {
        bg: '#fff7ed',
        border: '#fed7aa',
        text: '#9a3412',
        dot: colors.pendingSync,
      };
    case 'neutral':
    default:
      return {
        bg: colors.slate200,
        border: colors.slate300,
        text: colors.slate800,
        dot: colors.slate500,
      };
  }
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.base,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: spacing.base + 2,
    minHeight: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typography.labelSm,
    fontWeight: '700',
  },
});
