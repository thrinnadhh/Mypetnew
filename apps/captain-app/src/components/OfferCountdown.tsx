import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';
import { formatCountdown, getRemainingSeconds } from '../utils/date';

export interface OfferCountdownProps {
  expiresAt: string;
  onExpired?: () => void;
}

export const OfferCountdown: React.FC<OfferCountdownProps> = ({
  expiresAt,
  onExpired,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(() => getRemainingSeconds(expiresAt));

  useEffect(() => {
    const update = () => {
      const remaining = getRemainingSeconds(expiresAt);
      setSecondsLeft(remaining);
      if (remaining <= 0 && onExpired) {
        onExpired();
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const isUrgent = secondsLeft <= 10;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>OFFER EXPIRES IN</Text>
      <View style={[styles.timerBadge, isUrgent && styles.timerBadgeUrgent]}>
        <Text style={[styles.timerText, isUrgent && styles.timerTextUrgent]}>
          {formatCountdown(secondsLeft)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  label: {
    ...typography.caption,
    color: palette.inkMuted,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  timerBadge: {
    backgroundColor: palette.royalBlueSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.royalBlue,
  },
  timerBadgeUrgent: {
    backgroundColor: palette.errorSoft,
    borderColor: palette.error,
  },
  timerText: {
    ...typography.display,
    fontSize: 24,
    color: palette.royalBlue,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timerTextUrgent: {
    color: palette.error,
  },
});
