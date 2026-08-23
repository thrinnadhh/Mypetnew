import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../design/tokens';
import { Button } from './Button';

export interface RetryPanelProps {
  message?: string;
  onRetry: () => void;
  loading?: boolean;
}

export const RetryPanel: React.FC<RetryPanelProps> = ({
  message = 'Unable to complete action.',
  onRetry,
  loading = false,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.message}>{message}</Text>
      <Button
        disabled={loading}
        fullWidth={false}
        loading={loading}
        onPress={onRetry}
        style={styles.button}
        title="Retry"
        variant="outline"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  icon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: palette.ink,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  button: {
    minWidth: 140,
  },
});
