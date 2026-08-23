import { router } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { resetAllIdempotencyKeys } from '../../utils/idempotency';

export default function SettingsScreen() {
  const handleClearCache = () => {
    resetAllIdempotencyKeys();
    Alert.alert('Cache Cleared', 'Local command caches and diagnostic state have been cleared.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings & Diagnostics</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APPLICATION INFO</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>App Name</Text>
              <Text style={styles.value}>MyPet Captain</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Version</Text>
              <Text style={styles.value}>1.0.0 (Expo SDK 57)</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Role Boundary</Text>
              <Text style={styles.value}>CAPTAIN (Isolated)</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Environment</Text>
              <Text style={styles.value}>
                {process.env.EXPO_PUBLIC_APP_ENV || 'production'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DIAGNOSTICS & STORAGE</Text>
          <View style={styles.card}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={handleClearCache}
              style={styles.actionRow}
            >
              <View>
                <Text style={styles.actionTitle}>Clear Local Command Cache</Text>
                <Text style={styles.actionDesc}>Reset in-memory idempotency caches</Text>
              </View>
              <Text style={styles.actionLink}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Button
          onPress={() => router.back()}
          style={styles.backBtn}
          title="Back to Profile"
          variant="secondary"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  header: {
    backgroundColor: palette.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
  },
  title: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  content: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.body,
    color: palette.inkMuted,
  },
  value: {
    ...typography.body,
    color: palette.ink,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  actionDesc: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  actionLink: {
    ...typography.label,
    color: palette.royalBlue,
    fontWeight: '700',
  },
  backBtn: {
    marginTop: spacing.md,
  },
});
