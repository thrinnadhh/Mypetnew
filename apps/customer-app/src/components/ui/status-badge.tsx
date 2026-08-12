import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';

export function StatusBadge({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <ThemedText type="small" style={[styles.text, { color }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  text: {
    fontWeight: '800',
    fontSize: 11,
    textTransform: 'uppercase',
  },
});
