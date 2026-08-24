import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import {
  CaptainNotificationPermissionState,
  getCaptainNotificationPermission,
  registerCaptainNotifications,
} from '../../notifications/captain-notifications';

export default function NotificationsPermissionScreen() {
  const [permission, setPermission] = useState<CaptainNotificationPermissionState>('UNDETERMINED');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCaptainNotificationPermission()
      .then((state) => {
        if (active) setPermission(state);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requestPermission = async () => {
    setLoading(true);
    setError(null);
    try {
      setPermission(await registerCaptainNotifications(true));
    } catch {
      setError('Notification registration failed. Check your connection and device settings.');
    } finally {
      setLoading(false);
    }
  };

  const badgeVariant = permission === 'GRANTED' ? 'active' : permission === 'DENIED' ? 'error' : 'warning';
  const badgeLabel = permission === 'GRANTED' ? 'ACTIVE' : permission.replace('_', ' ');

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
            <StatusBadge label={badgeLabel} variant={badgeVariant} />
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.actions}>
          {permission !== 'GRANTED' && permission !== 'UNAVAILABLE' ? (
            <Button
              disabled={loading}
              loading={loading}
              onPress={requestPermission}
              title="Enable Notifications"
              variant="primary"
            />
          ) : null}
          <Button
            onPress={() => router.back()}
            title="Return to Profile"
            variant={permission === 'GRANTED' ? 'primary' : 'secondary'}
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
    gap: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
    color: palette.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
