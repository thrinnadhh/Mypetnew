import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface LoadingStateProps {
  message?: string;
  style?: ViewStyle;
  testID?: string;
}

export function LoadingState({
  message = 'Loading operational data…',
  style,
  testID = 'loading-state',
}: LoadingStateProps) {
  return (
    <View
      style={[styles.container, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.message}>{message}</Text>
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
    gap: spacing.md,
    minHeight: 180,
  },
  message: {
    ...typography.bodyMd,
    color: colors.slate600,
    textAlign: 'center',
  },
});
