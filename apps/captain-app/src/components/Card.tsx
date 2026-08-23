import React from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { palette, radii, spacing } from '../design/tokens';

export interface CardProps extends ViewProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ style, children, ...props }) => {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.lg,
    marginVertical: spacing.xs,
  },
});
