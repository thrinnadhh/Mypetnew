import React from 'react';
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native';
import { palette, radii, spacing, touchTarget, typography } from '../design/tokens';
import { DestinationParams, openDestinationNavigation } from '../features/navigation/navigation-provider';

export interface NavigationButtonProps {
  destination: DestinationParams;
  title?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const NavigationButton: React.FC<NavigationButtonProps> = ({
  destination,
  title = 'Open Navigation',
  style,
  textStyle,
}) => {
  const handlePress = () => {
    openDestinationNavigation(destination);
  };

  return (
    <TouchableOpacity
      accessibilityHint="Opens external maps application for directions"
      accessibilityLabel={title}
      accessibilityRole="button"
      activeOpacity={0.8}
      onPress={handlePress}
      style={[styles.button, style]}
    >
      <Text style={styles.icon}>🧭</Text>
      <Text style={[styles.text, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    backgroundColor: palette.royalBlueSoft,
    borderRadius: radii.compact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.royalBlue,
  },
  icon: {
    fontSize: 16,
  },
  text: {
    ...typography.label,
    color: palette.royalBlue,
    fontWeight: '700',
  },
});
