import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: string | React.ReactNode;
  actionTitle?: string;
  onAction?: () => void;
  style?: ViewStyle;
  testID?: string;
}

export function EmptyState({
  title,
  description,
  icon = '📋',
  actionTitle,
  onAction,
  style,
  testID = 'empty-state',
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="summary">
      <View style={styles.iconCircle}>
        {typeof icon === 'string' ? (
          <Text style={styles.iconText}>{icon}</Text>
        ) : (
          icon
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionTitle && onAction && (
        <PrimaryButton
          title={actionTitle}
          onPress={onAction}
          style={styles.actionButton}
          accessibilityLabel={`${actionTitle}: ${title}`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
    textAlign: 'center',
  },
  description: {
    ...typography.bodyMd,
    color: colors.slate600,
    textAlign: 'center',
    maxWidth: 280,
  },
  actionButton: {
    marginTop: spacing.sm,
  },
});
