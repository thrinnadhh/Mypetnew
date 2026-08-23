import { router } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import {
  checkLocationPermissions,
  LocationPermissionStatus,
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from '../../location/permissions';

export default function LocationPermissionScreen() {
  const [status, setStatus] = useState<LocationPermissionStatus>({
    state: 'UNKNOWN',
    foregroundGranted: false,
    backgroundGranted: false,
    canAskAgain: true,
  });
  const [requestingForeground, setRequestingForeground] = useState(false);
  const [requestingBackground, setRequestingBackground] = useState(false);

  const check = useCallback(async () => {
    const s = await checkLocationPermissions();
    setStatus(s);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await checkLocationPermissions();
      if (mounted) {
        setStatus(s);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleRequestForeground = async () => {
    setRequestingForeground(true);
    try {
      const s = await requestForegroundLocationPermission();
      setStatus(s);
    } finally {
      setRequestingForeground(false);
    }
  };

  const handleRequestBackground = async () => {
    setRequestingBackground(true);
    try {
      const s = await requestBackgroundLocationPermission();
      setStatus(s);
    } finally {
      setRequestingBackground(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📍</Text>
        </View>

        <Text style={styles.title}>Location Permissions</Text>
        <Text style={styles.subtitle}>
          MyPet Captain relies on precise real-time location to match you with nearby merchant orders, navigate store pickups, and calculate route progress.
        </Text>

        {/* STEP 1: FOREGROUND PERMISSION */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepText}>STEP 1</Text>
            </View>
            <StatusBadge
              label={status.foregroundGranted ? 'GRANTED' : 'REQUIRED'}
              variant={status.foregroundGranted ? 'active' : 'error'}
            />
          </View>

          <Text style={styles.cardTitle}>Foreground Location Access</Text>
          <Text style={styles.cardDesc}>
            Required while using the app to broadcast availability to the dispatch engine and view nearby orders.
          </Text>

          {!status.foregroundGranted && (
            <Button
              loading={requestingForeground}
              onPress={handleRequestForeground}
              style={styles.actionBtn}
              title="Allow While Using App"
              variant="primary"
            />
          )}
        </View>

        {/* STEP 2: BACKGROUND PERMISSION */}
        <View style={[styles.card, !status.foregroundGranted && styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepText}>STEP 2</Text>
            </View>
            <StatusBadge
              label={
                status.backgroundGranted
                  ? 'GRANTED'
                  : status.foregroundGranted
                  ? 'RECOMMENDED'
                  : 'PENDING STEP 1'
              }
              variant={
                status.backgroundGranted
                  ? 'active'
                  : status.foregroundGranted
                  ? 'warning'
                  : 'neutral'
              }
            />
          </View>

          <Text style={styles.cardTitle}>Background Location Access</Text>
          <Text style={styles.cardDesc}>
            Enables continuous tracking when your screen is locked or navigation runs in the background during active customer deliveries.
          </Text>

          {status.foregroundGranted && !status.backgroundGranted && (
            <Button
              loading={requestingBackground}
              onPress={handleRequestBackground}
              style={styles.actionBtn}
              title="Allow All The Time"
              variant="secondary"
            />
          )}
        </View>

        <View style={styles.actions}>
          <Button
            onPress={check}
            style={styles.backBtn}
            title="Refresh Status"
            variant="outline"
          />

          <Button
            onPress={() => router.back()}
            style={styles.backBtn}
            title="Done"
            variant="secondary"
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
    marginTop: spacing.md,
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
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  card: {
    width: '100%',
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  stepBadge: {
    backgroundColor: palette.royalBlueSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  stepText: {
    ...typography.caption,
    fontWeight: '700',
    color: palette.royalBlue,
    fontSize: 11,
  },
  cardTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  cardDesc: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 4,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  actionBtn: {
    marginTop: spacing.xs,
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  backBtn: {
    minHeight: 48,
  },
});
