import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  helperText?: string;
  containerStyle?: ViewStyle;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  containerStyle,
  leftElement,
  rightElement,
  style,
  ...props
}) => {
  const hasError = !!error;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputWrapper, hasError && styles.inputWrapperError]}>
        {leftElement ? <View style={styles.leftElement}>{leftElement}</View> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={palette.inkMuted}
          style={[styles.input, style]}
          {...props}
        />
        {rightElement ? <View style={styles.rightElement}>{rightElement}</View> : null}
      </View>
      {hasError ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: palette.ink,
    marginBottom: spacing.xs,
  },
  inputWrapper: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.md,
  },
  inputWrapperError: {
    borderColor: palette.error,
  },
  input: {
    flex: 1,
    minHeight: touchTarget,
    ...typography.body,
    color: palette.ink,
    paddingVertical: spacing.sm,
  },
  leftElement: {
    marginRight: spacing.sm,
  },
  rightElement: {
    marginLeft: spacing.sm,
  },
  errorText: {
    ...typography.caption,
    color: palette.error,
    marginTop: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: spacing.xs,
  },
});
