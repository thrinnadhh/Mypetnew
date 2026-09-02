import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';

export type UnknownOutcomeBannerProps = {
  idempotencyKey: string;
  checking: boolean;
  onCheckStatus: () => void;
  onDismiss: () => void;
};

export function UnknownOutcomeBanner({
  idempotencyKey,
  checking,
  onCheckStatus,
  onDismiss,
}: UnknownOutcomeBannerProps) {
  return (
    <View style={styles.banner} testID="unknown-outcome-banner">
      <View style={styles.content}>
        <Text style={styles.title}>Network Outcome Uncertain</Text>
        <Text style={styles.body}>
          The connection was interrupted during checkout. Reconciling server status with key{' '}
          <Text style={styles.keyText}>{idempotencyKey.slice(0, 16)}…</Text>
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check sale status on server"
            disabled={checking}
            onPress={onCheckStatus}
            style={styles.checkButton}
          >
            {checking ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.checkButtonText}>Check Status</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss outcome banner"
            disabled={checking}
            onPress={onDismiss}
            style={styles.dismissButton}
          >
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  content: {
    gap: spacing.xs,
  },
  title: {
    ...typography.headlineMd,
    color: colors.primary,
    fontSize: 16,
  },
  body: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontSize: 13,
  },
  keyText: {
    ...typography.codeSm,
    color: colors.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  checkButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonText: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  dismissButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    ...typography.labelMd,
    color: colors.onSurface,
  },
});
