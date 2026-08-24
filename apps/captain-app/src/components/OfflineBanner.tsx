import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../design/tokens';

export interface OfflineBannerProps {
  visible?: boolean;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ visible = true }) => {
  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>⚠️ No internet connection. Some actions may be unavailable.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.ink,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...typography.caption,
    color: palette.white,
    fontWeight: '600',
  },
});
