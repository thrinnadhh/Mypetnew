import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';

export interface OnlineToggleProps {
  online: boolean;
  loading?: boolean;
  onToggle: () => void;
}

export const OnlineToggle: React.FC<OnlineToggleProps> = ({
  online,
  loading = false,
  onToggle,
}) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityLabel={online ? 'Tap to go offline' : 'Tap to go online'}
        accessibilityRole="button"
        accessibilityState={{ busy: loading }}
        activeOpacity={0.85}
        disabled={loading}
        onPress={onToggle}
        style={[
          styles.button,
          online ? styles.buttonOnline : styles.buttonOffline,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.white} size="small" />
        ) : (
          <View style={styles.content}>
            <View style={[styles.pulseDot, online ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.buttonText}>
              {online ? 'GO OFFLINE' : 'GO ONLINE'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      <Text style={styles.hintText}>
        {online
          ? 'You are online. Ready to receive delivery orders nearby.'
          : 'You are offline. Go online to start receiving delivery requests.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  button: {
    width: '100%',
    minHeight: 56,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonOnline: {
    backgroundColor: palette.error,
  },
  buttonOffline: {
    backgroundColor: palette.emerald,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.white,
  },
  dotOnline: {
    backgroundColor: palette.white,
  },
  dotOffline: {
    backgroundColor: palette.white,
  },
  buttonText: {
    ...typography.title,
    color: palette.white,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  hintText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
