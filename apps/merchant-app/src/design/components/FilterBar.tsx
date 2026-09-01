import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface FilterOption<T extends string = string> {
  id: T;
  label: string;
  badge?: number | string;
  icon?: string;
}

export interface FilterBarProps<T extends string = string> {
  options: FilterOption<T>[];
  selectedId: T;
  onSelect: (id: T) => void;
  style?: ViewStyle;
  testID?: string;
}

export function FilterBar<T extends string = string>({
  options,
  selectedId,
  onSelect,
  style,
  testID,
}: FilterBarProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.container, style]}
      accessibilityRole="tablist"
      testID={testID}
    >
      {options.map((option) => {
        const isSelected = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            onPress={() => onSelect(option.id)}
            style={[
              styles.chip,
              isSelected ? styles.chipSelected : styles.chipUnselected,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={
              option.badge !== undefined
                ? `${option.label}, ${option.badge} items`
                : option.label
            }
            testID={testID ? `${testID}-chip-${option.id}` : undefined}
          >
            {option.icon ? (
              <Text style={styles.icon}>{option.icon}</Text>
            ) : null}
            <Text
              style={[
                styles.label,
                isSelected ? styles.labelSelected : styles.labelUnselected,
              ]}
            >
              {option.label}
            </Text>
            {option.badge !== undefined ? (
              <View
                style={[
                  styles.badge,
                  isSelected ? styles.badgeSelected : styles.badgeUnselected,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isSelected
                      ? styles.badgeTextSelected
                      : styles.badgeTextUnselected,
                  ]}
                >
                  {option.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  icon: {
    fontSize: 14,
  },
  label: {
    ...typography.labelMd,
  },
  labelSelected: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  labelUnselected: {
    color: colors.slate700,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.full,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  badgeUnselected: {
    backgroundColor: colors.slate200,
  },
  badgeText: {
    ...typography.labelSm,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextSelected: {
    color: colors.onPrimary,
  },
  badgeTextUnselected: {
    color: colors.slate700,
  },
});
