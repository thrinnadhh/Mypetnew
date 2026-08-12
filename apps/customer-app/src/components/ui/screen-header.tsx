import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  trailing,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  trailing?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
      <View style={styles.copy}>
        {eyebrow ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.eyebrow}>
            {eyebrow}
          </ThemedText>
        ) : null}
        <ThemedText style={styles.title}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
  },
  copy: { flex: 1, gap: 4 },
  eyebrow: {
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
  },
});
