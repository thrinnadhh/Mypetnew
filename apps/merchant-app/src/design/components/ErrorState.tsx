import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryTitle?: string;
  style?: ViewStyle;
  testID?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryTitle = 'Retry',
  style,
  testID = 'error-state',
}: ErrorStateProps) {
  return (
    <View
      style={[styles.container, style]}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <View style={styles.iconCircle}>
        <Text style={styles.iconText}>⚠️</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <PrimaryButton
          title={retryTitle}
          onPress={onRetry}
          variant="primary"
          style={styles.retryButton}
          accessibilityLabel={`Retry action: ${title}`}
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
    backgroundColor: '#fff5f5',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#fca5a5',
    gap: spacing.xs,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconText: {
    fontSize: 24,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onErrorContainer,
    textAlign: 'center',
  },
  message: {
    ...typography.bodyMd,
    color: colors.slate700,
    textAlign: 'center',
    maxWidth: 300,
  },
  retryButton: {
    marginTop: spacing.sm,
    minWidth: 140,
  },
});
