import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

export type StatusVariant =
  | 'online'
  | 'offline'
  | 'active'
  | 'pending'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'assigned'
  | 'pickedUp'
  | 'delivered';

export interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  style?: ViewStyle;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant = 'neutral',
  style,
}) => {
  const getBadgeStyle = (): ViewStyle => {
    switch (variant) {
      case 'online':
      case 'active':
      case 'delivered':
        return styles.success;
      case 'pending':
      case 'assigned':
      case 'warning':
        return styles.warning;
      case 'pickedUp':
        return styles.primary;
      case 'error':
        return styles.error;
      case 'offline':
      case 'neutral':
      default:
        return styles.neutral;
    }
  };

  const getTextStyle = () => {
    switch (variant) {
      case 'online':
      case 'active':
      case 'delivered':
        return styles.textSuccess;
      case 'pending':
      case 'assigned':
      case 'warning':
        return styles.textWarning;
      case 'pickedUp':
        return styles.textPrimary;
      case 'error':
        return styles.textError;
      case 'offline':
      case 'neutral':
      default:
        return styles.textNeutral;
    }
  };

  const getDotStyle = () => {
    switch (variant) {
      case 'online':
      case 'active':
      case 'delivered':
        return styles.dotSuccess;
      case 'pending':
      case 'assigned':
      case 'warning':
        return styles.dotWarning;
      case 'pickedUp':
        return styles.dotPrimary;
      case 'error':
        return styles.dotError;
      case 'offline':
      case 'neutral':
      default:
        return styles.dotNeutral;
    }
  };

  return (
    <View
      accessibilityLabel={`Status: ${label}`}
      style={[styles.badge, getBadgeStyle(), style]}
    >
      <View style={[styles.dot, getDotStyle()]} />
      <Text style={[styles.text, getTextStyle()]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  success: {
    backgroundColor: palette.emeraldSoft,
  },
  dotSuccess: {
    backgroundColor: palette.emerald,
  },
  textSuccess: {
    color: '#065F46',
  },
  warning: {
    backgroundColor: palette.amberSoft,
  },
  dotWarning: {
    backgroundColor: palette.amber,
  },
  textWarning: {
    color: '#92400E',
  },
  primary: {
    backgroundColor: palette.royalBlueSoft,
  },
  dotPrimary: {
    backgroundColor: palette.royalBlue,
  },
  textPrimary: {
    color: palette.royalBlue,
  },
  error: {
    backgroundColor: palette.errorSoft,
  },
  dotError: {
    backgroundColor: palette.error,
  },
  textError: {
    color: palette.error,
  },
  neutral: {
    backgroundColor: palette.outlineSoft,
  },
  dotNeutral: {
    backgroundColor: palette.inkMuted,
  },
  textNeutral: {
    color: palette.ink,
  },
});
