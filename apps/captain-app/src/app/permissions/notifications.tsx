import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';

export default function NotificationsPermissionScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🔔</Text>
        </View>

        <Text style={styles.title}>Push Notifications</Text>
        <Text style={styles.subtitle}>
          Push notifications allow the server to notify you instantly when a customer delivery order is offered in your zone.
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Order Notifications</Text>
              <Text style={styles.rowDesc}>Instant audible and visual dispatch alerts</Text>
            </View>
            <StatusBadge label="ACTIVE" variant="active" />
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            onPress={() => router.back()}
            title="Return to Profile"
            variant="primary"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.royalBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: palette.inkMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  card: {
    width: '100%',
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  rowDesc: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  actions: {
    width: '100%',
  },
});
