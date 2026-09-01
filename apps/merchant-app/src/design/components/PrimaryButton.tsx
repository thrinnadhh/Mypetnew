import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'destructive' | 'success';
  style?: ViewStyle;
  accessibilityLabel?: string;
  testID?: string;
}

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
  accessibilityLabel,
  testID,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const btnStyle = getVariantStyle(variant, isDisabled);

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        btnStyle.container,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? title}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={btnStyle.textColor} size="small" />
      ) : (
        <Text style={[styles.text, { color: btnStyle.textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

function getVariantStyle(variant: 'primary' | 'destructive' | 'success', disabled: boolean) {
  if (disabled) {
    return {
      container: { backgroundColor: colors.slate300, borderColor: colors.slate300 },
      textColor: colors.slate500,
    };
  }
  switch (variant) {
    case 'destructive':
      return {
        container: { backgroundColor: colors.error, borderColor: colors.error },
        textColor: colors.onError,
      };
    case 'success':
      return {
        container: { backgroundColor: colors.success, borderColor: colors.success },
        textColor: colors.onSuccess,
      };
    case 'primary':
    default:
      return {
        container: { backgroundColor: colors.primary, borderColor: colors.primary },
        textColor: colors.onPrimary,
      };
  }
}

const styles = StyleSheet.create({
  button: {
    minHeight: spacing.touchTargetMin,
    minWidth: spacing.touchTargetMin,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.65,
  },
  text: {
    ...typography.labelLg,
    textAlign: 'center',
  },
});
