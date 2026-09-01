import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export type OfflineBannerVariant = 'offline' | 'pending' | 'syncing' | 'failed';

export interface OfflineBannerProps {
  variant: OfflineBannerVariant;
  pendingCount?: number;
  message?: string;
  onAction?: () => void;
  actionLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

export function OfflineBanner({
  variant,
  pendingCount = 0,
  message,
  onAction,
  actionLabel = 'Sync now',
  style,
  testID = 'offline-banner',
}: OfflineBannerProps) {
  const config = getBannerConfig(variant, pendingCount, message);

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: config.bg, borderColor: config.border },
        style,
      ]}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${config.title}. ${config.description}`}
    >
      <View style={styles.iconColumn}>
        <Text style={styles.iconText}>{config.icon}</Text>
      </View>
      <View style={styles.textColumn}>
        <Text style={[styles.title, { color: config.textColor }]}>{config.title}</Text>
        <Text style={[styles.description, { color: config.descColor }]}>
          {config.description}
        </Text>
      </View>
      {onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: config.buttonBg, borderColor: config.buttonBorder },
            pressed && styles.actionButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} - ${config.title}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.actionText, { color: config.buttonTextColor }]}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function getBannerConfig(variant: OfflineBannerVariant, pendingCount: number, customMessage?: string) {
  switch (variant) {
    case 'pending':
      return {
        icon: '⏳',
        title: pendingCount > 0 ? `${pendingCount} Pending Local Changes` : 'Pending Local Changes',
        description: customMessage ?? 'Changes saved to device SQLite. Will upload when online.',
        bg: '#fffbeb',
        border: '#fde68a',
        textColor: '#92400e',
        descColor: '#b45309',
        buttonBg: '#fef3c7',
        buttonBorder: '#f59e0b',
        buttonTextColor: '#78350f',
      };
    case 'syncing':
      return {
        icon: '🔄',
        title: 'Synchronizing with server…',
        description: customMessage ?? 'Uploading outbox commands and refreshing projections.',
        bg: '#eff6ff',
        border: '#bfdbfe',
        textColor: '#1e40af',
        descColor: '#2563eb',
        buttonBg: '#dbeafe',
        buttonBorder: '#3b82f6',
        buttonTextColor: '#1e3a8a',
      };
    case 'failed':
      return {
        icon: '⚠️',
        title: 'Sync Encountered Conflicts or Errors',
        description: customMessage ?? 'Some local commands could not be processed. Review sync status.',
        bg: '#fef2f2',
        border: '#fecaca',
        textColor: '#991b1b',
        descColor: '#b91c1c',
        buttonBg: '#fee2e2',
        buttonBorder: '#ef4444',
        buttonTextColor: '#7f1d1d',
      };
    case 'offline':
    default:
      return {
        icon: '📡',
        title: 'Offline Mode Active',
        description: customMessage ?? 'Using local cached data. New entries queued for sync.',
        bg: colors.slate100,
        border: colors.slate300,
        textColor: colors.slate900,
        descColor: colors.slate600,
        buttonBg: colors.surface,
        buttonBorder: colors.slate400,
        buttonTextColor: colors.slate800,
      };
  }
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  iconColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 20,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.labelMd,
    fontWeight: '700',
  },
  description: {
    ...typography.bodySm,
    lineHeight: 16,
  },
  actionButton: {
    minHeight: spacing.touchTargetMin,
    minWidth: spacing.touchTargetMin,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.75,
  },
  actionText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
});
