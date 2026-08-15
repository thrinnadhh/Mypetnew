import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ServiceTile({
  title,
  subtitle,
  icon,
  tone = 'primary',
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: AppIconName;
  tone?: 'primary' | 'cta' | 'accent';
  onPress: () => void;
}) {
  const theme = useTheme();
  const toneColor = tone === 'cta' ? theme.cta : tone === 'accent' ? theme.accent : theme.primary;
  const toneBg = tone === 'cta' ? theme.ctaSoft : tone === 'accent' ? theme.muted : theme.primarySoft;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.iconWrap, { backgroundColor: toneBg }]}>
        <AppIcon name={icon} color={toneColor} size={24} />
      </View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {subtitle}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '48%',
    minHeight: 132,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
    ...Shadows.card,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
  },
});
