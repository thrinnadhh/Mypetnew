import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

export interface LocationStatusBannerProps {
  message?: string;
  onPressAction?: () => void;
  actionText?: string;
}

export const LocationStatusBanner: React.FC<LocationStatusBannerProps> = ({
  message = 'Location is required to receive nearby delivery requests.',
  onPressAction,
  actionText = 'Enable Location',
}) => {
  return (
    <View style={styles.banner}>
      <Text style={styles.icon}>📍</Text>
      <View style={styles.content}>
        <Text style={styles.message}>{message}</Text>
        {onPressAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onPressAction}
            style={styles.actionBtn}
          >
            <Text style={styles.actionText}>{actionText}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: palette.amberSoft,
    borderWidth: 1,
    borderColor: palette.amber,
    borderRadius: radii.compact,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  icon: {
    fontSize: 20,
  },
  content: {
    flex: 1,
  },
  message: {
    ...typography.bodySmall,
    color: '#78350F',
    lineHeight: 18,
  },
  actionBtn: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  actionText: {
    ...typography.label,
    color: '#92400E',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
