import { router } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/context';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useDelivery } from '../../features/delivery/delivery-context';

export default function ProfileTabScreen() {
  const { captainProfile, logout } = useAuth();
  const { activeDelivery } = useDelivery();

  const handleLogout = () => {
    if (activeDelivery) {
      Alert.alert(
        'Active Delivery in Progress',
        'You have an active delivery assigned. Please complete the delivery before logging out.',
        [{ text: 'OK' }],
      );
      return;
    }

    Alert.alert('Confirm Logout', 'Are you sure you want to log out of your Captain account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/auth/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Profile Card Header */}
        <View style={styles.profileHeaderCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {captainProfile?.name ? captainProfile.name.charAt(0).toUpperCase() : 'C'}
            </Text>
          </View>
          <Text style={styles.captainName}>{captainProfile?.name || 'Captain Partner'}</Text>
          <Text style={styles.captainPhone}>{captainProfile?.mobile || '+91 —'}</Text>
          <View style={styles.statusBadgeWrapper}>
            <StatusBadge
              label={captainProfile?.status || 'ACTIVE'}
              variant={captainProfile?.status === 'ACTIVE' ? 'active' : 'pending'}
            />
          </View>
        </View>

        {/* Verification Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VERIFICATION & COMPLIANCE</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Driving License</Text>
              <StatusBadge label="VERIFIED" variant="active" />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Vehicle RC</Text>
              <StatusBadge label="VERIFIED" variant="active" />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Bank Account</Text>
              <StatusBadge label="VERIFIED" variant="active" />
            </View>
          </View>
        </View>

        {/* Vehicle Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>REGISTERED VEHICLE</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {captainProfile?.vehicle?.model || 'Motorcycle'}
            </Text>
            <Text style={styles.cardSub}>
              Reg No: {captainProfile?.vehicle?.registrationNumber || 'KA 01 AB 1234'}
            </Text>
          </View>
        </View>

        {/* Bank & Payout Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SETTLEMENT BANK ACCOUNT</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {captainProfile?.bank?.bankName || 'State Bank of India'}
            </Text>
            <Text style={styles.cardSub}>
              Account: {captainProfile?.bank?.accountNumberMasked || '••••••••1234'}
            </Text>
            <Text style={styles.cardSub}>
              IFSC: {captainProfile?.bank?.ifscMasked || 'SBIN000XXXX'}
            </Text>
          </View>
        </View>

        {/* Navigation Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SETTINGS & HELP</Text>
          <View style={styles.menuCard}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/permissions/location')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>📍</Text>
              <Text style={styles.menuText}>Location & GPS Health</Text>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/permissions/notifications')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>🔔</Text>
              <Text style={styles.menuText}>Push Notifications</Text>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/support')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>💬</Text>
              <Text style={styles.menuText}>Help & Support</Text>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={styles.menuItem}
            >
              <Text style={styles.menuIcon}>⚙️</Text>
              <Text style={styles.menuText}>App Settings & Diagnostics</Text>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <Button
            onPress={handleLogout}
            title="Log Out of Captain App"
            variant="destructive"
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
  },
  profileHeaderCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    ...typography.display,
    color: palette.white,
    fontSize: 28,
  },
  captainName: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 20,
  },
  captainPhone: {
    ...typography.body,
    color: palette.inkMuted,
    marginTop: 2,
  },
  statusBadgeWrapper: {
    marginTop: spacing.md,
  },
  section: {
    marginBottom: spacing.lg,
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
  cardTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  cardSub: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  rowLabel: {
    ...typography.body,
    color: palette.ink,
  },
  menuCard: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
  },
  menuIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  menuText: {
    ...typography.body,
    color: palette.ink,
    flex: 1,
  },
  menuChevron: {
    fontSize: 20,
    color: palette.inkMuted,
  },
  logoutSection: {
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
});
