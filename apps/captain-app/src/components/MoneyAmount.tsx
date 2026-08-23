import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { palette, typography } from '../design/tokens';
import { formatPaise } from '../utils/money';

export interface MoneyAmountProps {
  paise: number | null | undefined;
  style?: TextStyle;
  compact?: boolean;
}

export const MoneyAmount: React.FC<MoneyAmountProps> = ({ paise, style, compact }) => {
  return (
    <Text
      accessibilityLabel={`Amount: ${formatPaise(paise, { showZero: true, compact })}`}
      style={[styles.text, style]}
    >
      {formatPaise(paise, { showZero: true, compact })}
    </Text>
  );
};

const styles = StyleSheet.create({
  text: {
    ...typography.title,
    color: palette.ink,
    fontWeight: '700',
  },
});
