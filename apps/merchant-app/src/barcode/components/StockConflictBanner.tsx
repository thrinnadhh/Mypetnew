import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';

export type StockConflictBannerProps = {
  message: string;
  onDismiss: () => void;
};

export function StockConflictBanner({ message, onDismiss }: StockConflictBannerProps) {
  return (
    <View style={styles.banner} testID="stock-conflict-banner">
      <View style={styles.textContainer}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.message} accessibilityRole="alert">
          {message}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss stock conflict banner"
        onPress={onDismiss}
        style={styles.dismissButton}
      >
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff7ed',
    borderWidth: 1.5,
    borderColor: '#ea580c',
    borderRadius: radius.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: 16,
  },
  message: {
    ...typography.bodyMd,
    color: '#9a3412',
    fontWeight: '600',
    flex: 1,
  },
  dismissButton: {
    padding: spacing.xs,
  },
  dismissText: {
    fontSize: 14,
    color: '#9a3412',
    fontWeight: '700',
  },
});
