import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { touchTarget } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  trailing,
  onBack,
  backLabel = 'Back',
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  trailing?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            pressed && styles.pressed,
          ]}
        >
          <AppIcon name="chevron" color={theme.text} size={20} style={styles.backIcon} />
        </Pressable>
      ) : null}
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
  backButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { transform: [{ rotate: '180deg' }] },
  pressed: { opacity: 0.72 },
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
