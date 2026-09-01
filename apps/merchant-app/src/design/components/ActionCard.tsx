import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface ActionCardProps {
  title: string;
  subtitle?: string;
  icon?: string | React.ReactNode;
  badge?: string | number;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'neutral';
  style?: ViewStyle;
  testID?: string;
}

export function ActionCard({
  title,
  subtitle,
  icon,
  badge,
  onPress,
  variant = 'neutral',
  style,
  testID,
}: ActionCardProps) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isPrimary && styles.primaryCard,
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`}
      testID={testID}
    >
      <View style={styles.contentRow}>
        {icon && (
          <View style={[styles.iconContainer, isPrimary && styles.primaryIconContainer]}>
            {typeof icon === 'string' ? (
              <Text style={[styles.iconText, isPrimary && styles.primaryIconText]}>{icon}</Text>
            ) : (
              icon
            )}
          </View>
        )}
        <View style={styles.textContainer}>
          <Text style={[styles.title, isPrimary && styles.primaryTitle]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.subtitle, isPrimary && styles.primarySubtitle]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {badge !== undefined && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: spacing.touchTargetMin,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  primaryCard: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryIconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  iconText: {
    fontSize: 18,
  },
  primaryIconText: {
    color: '#ffffff',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.labelLg,
    color: colors.slate900,
  },
  primaryTitle: {
    color: '#ffffff',
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  primarySubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  badge: {
    backgroundColor: colors.error,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
});
