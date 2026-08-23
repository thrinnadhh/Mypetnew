import React, { useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';

export interface ProofCodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  label?: string;
  instructions?: string;
}

export const ProofCodeInput: React.FC<ProofCodeInputProps> = ({
  length = 4,
  value,
  onChange,
  error,
  label = 'Verification Code',
  instructions = 'Ask for the 4-digit code to confirm',
}) => {
  const inputRefs = useRef<Array<TextInput | null>>([]);
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length);

  const handleDigitChange = (text: string, index: number) => {
    const cleaned = text.replace(/\D/g, '');
    if (!cleaned) {
      const next = digits.slice();
      next[index] = '';
      onChange(next.join(''));
      return;
    }

    if (cleaned.length > 1) {
      // Pasted full code
      const pasted = cleaned.slice(0, length);
      onChange(pasted);
      const targetFocus = Math.min(pasted.length, length - 1);
      inputRefs.current[targetFocus]?.focus();
      return;
    }

    const next = digits.slice();
    next[index] = cleaned;
    const combined = next.join('');
    onChange(combined);

    if (index < length - 1 && cleaned) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number,
  ) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.instructions}>{instructions}</Text>

      <View style={styles.boxesRow}>
        {Array.from({ length }).map((_, index) => {
          const isFilled = !!digits[index];
          const hasError = !!error;

          return (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              accessibilityLabel={`Digit ${index + 1} of ${length}`}
              keyboardType="number-pad"
              maxLength={index === 0 ? length : 1}
              onChangeText={(text) => handleDigitChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              selectTextOnFocus
              style={[
                styles.box,
                isFilled && styles.boxFilled,
                hasError && styles.boxError,
              ]}
              value={digits[index]}
            />
          );
        })}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  label: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    textAlign: 'center',
  },
  instructions: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  boxesRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
  },
  box: {
    width: 56,
    height: 56,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1.5,
    borderColor: palette.outlineSoft,
    backgroundColor: palette.white,
    textAlign: 'center',
    ...typography.display,
    fontSize: 24,
    color: palette.ink,
    fontWeight: '800',
  },
  boxFilled: {
    borderColor: palette.royalBlue,
    backgroundColor: palette.royalBlueSoft,
  },
  boxError: {
    borderColor: palette.error,
    backgroundColor: palette.errorSoft,
  },
  errorText: {
    ...typography.caption,
    color: palette.error,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
