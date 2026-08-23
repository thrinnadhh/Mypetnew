import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import {
  checkLocationPermissions,
  requestLocationPermissions,
} from '../../features/location/location-permissions';

export default function LocationPermissionScreen() {
  const [status, setStatus] = useState({
    foregroundGranted: false,
    backgroundGranted: false,
  });
  const [requesting, setRequesting] = useState(false);

  const check = async () => {
    const s = await checkLocationPermissions();
    setStatus(s);
  };

  useEffect(() => {
    check();
  }, []);

  const handleRequest = async () => {
    setRequesting(true);
    try {
      const s = await requestLocationPermissions();
      setStatus(s);
    } finally {
      setRequesting(false);
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

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Foreground Location</Text>
              <Text style={styles.rowDesc}>Required while using the application</Text>
            </View>
            <StatusBadge
              label={status.foregroundGranted ? 'ALLOWED' : 'DENIED'}
              variant={status.foregroundGranted ? 'active' : 'error'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>Background Location</Text>
              <Text style={styles.rowDesc}>Required to receive orders when phone is locked</Text>
            </View>
            <StatusBadge
              label={status.backgroundGranted ? 'ALLOWED' : 'OPTIONAL'}
              variant={status.backgroundGranted ? 'active' : 'warning'}
            />
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            loading={requesting}
            onPress={handleRequest}
            title={status.foregroundGranted ? 'Refresh Permission State' : 'Allow Location Access'}
            variant="primary"
          />

          <Button
            onPress={() => router.back()}
            style={styles.backBtn}
            title="Back"
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
    paddingVertical: spacing.xs,
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
  divider: {
    height: 1,
    backgroundColor: palette.outlineSoft,
    marginVertical: spacing.md,
  },
  actions: {
    width: '100%',
    gap: spacing.md,
  },
  backBtn: {
    minHeight: 48,
  },
});
