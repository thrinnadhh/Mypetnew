import React from 'react';
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';
import { dialPhoneNumber } from '../features/navigation/phone-dialer';

export interface ContactButtonProps {
  phoneNumber?: string | null;
  title?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const ContactButton: React.FC<ContactButtonProps> = ({
  phoneNumber,
  title = 'Call',
  style,
  textStyle,
}) => {
  if (!phoneNumber) return null;

  const handlePress = () => {
    dialPhoneNumber(phoneNumber);
  };

  return (
    <TouchableOpacity
      accessibilityHint="Opens phone dialer"
      accessibilityLabel={`Call ${phoneNumber}`}
      accessibilityRole="button"
      activeOpacity={0.8}
      onPress={handlePress}
      style={[styles.button, style]}
    >
      <Text style={styles.icon}>📞</Text>
      <Text style={[styles.text, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    backgroundColor: palette.emeraldSoft,
    borderRadius: radii.compact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.emerald,
  },
  icon: {
    fontSize: 16,
  },
  text: {
    ...typography.label,
    color: '#065F46',
    fontWeight: '700',
  },
});
