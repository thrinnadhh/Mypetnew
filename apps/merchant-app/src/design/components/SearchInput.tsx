import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  onBarcodeScan?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search…',
  onClear,
  onBarcodeScan,
  accessibilityLabel = 'Search input',
  style,
  testID,
}: SearchInputProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.slate400}
        accessibilityLabel={accessibilityLabel}
        style={styles.input}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => {
            onChangeText('');
            onClear?.();
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search text"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.actionButton}
        >
          <Text style={styles.clearIcon}>✕</Text>
        </Pressable>
      ) : null}
      {onBarcodeScan ? (
        <Pressable
          onPress={onBarcodeScan}
          accessibilityRole="button"
          accessibilityLabel="Open barcode scanner"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.actionButton}
          testID={testID ? `${testID}-barcode-button` : undefined}
        >
          <Text style={styles.barcodeIcon}>📷</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: spacing.touchTargetMin,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  searchIcon: {
    fontSize: 16,
    color: colors.slate400,
  },
  input: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    ...typography.bodyMd,
    color: colors.onSurface,
    paddingVertical: spacing.xs,
  },
  actionButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  clearIcon: {
    fontSize: 14,
    color: colors.slate500,
    fontWeight: '700',
  },
  barcodeIcon: {
    fontSize: 18,
  },
});
