import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, spacing, typography } from '../tokens';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionText?: string;
  onAction?: () => void;
  style?: ViewStyle;
  testID?: string;
}

export function SectionHeader({
  title,
  subtitle,
  actionText,
  onAction,
  style,
  testID,
}: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.textColumn}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {actionText && onAction && (
        <Pressable
          onPress={onAction}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={`${actionText} for ${title}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.actionText}>{actionText}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.headlineMd,
    color: colors.slate900,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  actionButton: {
    minHeight: spacing.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  actionText: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: '700',
  },
});
