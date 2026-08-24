import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  TouchableOpacityProps,
  ViewStyle,
} from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'success';

export interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  textStyle,
  icon,
  ...props
}) => {
  const getContainerStyle = (): ViewStyle => {
    switch (variant) {
      case 'secondary':
        return styles.secondary;
      case 'outline':
        return styles.outline;
      case 'destructive':
        return styles.destructive;
      case 'success':
        return styles.success;
      case 'primary':
      default:
        return styles.primary;
    }
  };

  const getTextStyle = (): TextStyle => {
    switch (variant) {
      case 'secondary':
        return styles.textSecondary;
      case 'outline':
        return styles.textOutline;
      case 'destructive':
        return styles.textDestructive;
      case 'success':
        return styles.textSuccess;
      case 'primary':
      default:
        return styles.textPrimary;
    }
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      activeOpacity={0.8}
      disabled={isDisabled}
      style={[
        styles.base,
        getContainerStyle(),
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'outline' || variant === 'secondary' ? palette.royalBlue : palette.white}
          size="small"
        />
      ) : (
        <>
          {icon ? <>{icon}</> : null}
          <Text style={[styles.textBase, getTextStyle(), textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radii.compact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  primary: {
    backgroundColor: palette.royalBlue,
  },
  secondary: {
    backgroundColor: palette.royalBlueSoft,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: palette.royalBlue,
  },
  destructive: {
    backgroundColor: palette.error,
  },
  success: {
    backgroundColor: palette.emerald,
  },
  disabled: {
    opacity: 0.5,
  },
  textBase: {
    ...typography.title,
    fontSize: 16,
    textAlign: 'center',
  },
  textPrimary: {
    color: palette.white,
    fontWeight: '700',
  },
  textSecondary: {
    color: palette.royalBlue,
    fontWeight: '700',
  },
  textOutline: {
    color: palette.royalBlue,
    fontWeight: '700',
  },
  textDestructive: {
    color: palette.white,
    fontWeight: '700',
  },
  textSuccess: {
    color: palette.white,
    fontWeight: '700',
  },
});
