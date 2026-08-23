import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  accentColor?: string;
}

export function MetricCard({
  label,
  value,
  subValue,
  accentColor = palette.royalBlue,
}: MetricCardProps) {
  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {subValue ? <Text style={styles.subValue}>{subValue}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    backgroundColor: palette.white,
    padding: spacing.x3,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderLeftWidth: 4,
    gap: spacing.x1,
  },
  label: {
    ...typography.caption,
    color: palette.inkMuted,
    textTransform: 'uppercase',
  },
  value: {
    ...typography.title,
    fontSize: 20,
    color: palette.ink,
  },
  subValue: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    fontSize: 12,
  },
});
