import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export type SyncStateMode = 'online' | 'offline' | 'syncing' | 'pending' | 'failed';

export interface SyncIndicatorProps {
  mode: SyncStateMode;
  pendingCount?: number;
  onPress?: () => void;
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function SyncIndicator({
  mode,
  pendingCount = 0,
  onPress,
  compact = false,
  style,
  testID = 'sync-indicator',
}: SyncIndicatorProps) {
  const meta = getSyncMeta(mode, pendingCount);

  const content = (
    <View
      style={[
        styles.container,
        compact ? styles.compactContainer : styles.fullContainer,
        { backgroundColor: meta.bg, borderColor: meta.border },
        style,
      ]}
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`Sync status: ${meta.label}. ${meta.description}`}
    >
      <View style={[styles.dot, { backgroundColor: meta.dotColor }]} />
      {!compact && (
        <Text style={[styles.text, { color: meta.textColor }]}>
          {meta.label}
        </Text>
      )}
      {pendingCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={styles.pressableWrapper}
        accessibilityRole="button"
        accessibilityLabel={`View sync status: ${meta.label}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

function getSyncMeta(mode: SyncStateMode, pendingCount: number) {
  switch (mode) {
    case 'online':
      return {
        label: 'Online',
        description: 'Connected to server',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        dotColor: colors.success,
        textColor: '#15803d',
      };
    case 'syncing':
      return {
        label: 'Syncing…',
        description: 'Uploading local changes to server',
        bg: '#eff6ff',
        border: '#bfdbfe',
        dotColor: colors.syncing,
        textColor: '#1d4ed8',
      };
    case 'pending':
      return {
        label: pendingCount > 0 ? `${pendingCount} Pending` : 'Pending sync',
        description: 'Unsent local mutations in outbox',
        bg: '#fff7ed',
        border: '#fed7aa',
        dotColor: colors.pendingSync,
        textColor: '#c2410c',
      };
    case 'failed':
      return {
        label: 'Sync failed',
        description: 'Outbox commands encountered errors or conflicts',
        bg: '#fef2f2',
        border: '#fecaca',
        dotColor: colors.syncFailed,
        textColor: '#b91c1c',
      };
    case 'offline':
    default:
      return {
        label: 'Offline (Local)',
        description: 'Working against local SQLite database',
        bg: colors.slate200,
        border: colors.slate300,
        dotColor: colors.slate500,
        textColor: colors.slate700,
      };
  }
}

const styles = StyleSheet.create({
  pressableWrapper: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.full,
    gap: spacing.base + 2,
  },
  compactContainer: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs - 2,
    minHeight: 28,
  },
  fullContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...typography.labelSm,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
});
