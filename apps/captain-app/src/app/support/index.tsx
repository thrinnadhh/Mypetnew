import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useDeliveryStore } from '../../state/delivery-store';

export default function SupportLandingScreen() {
  const { activeDelivery } = useDeliveryStore();

  const categories = [
    {
      id: 'ACTIVE_DELIVERY',
      title: 'Active Delivery Issue',
      desc: activeDelivery
        ? `Issues with ${activeDelivery.orderReference || activeDelivery.orderId} (${activeDelivery.outletName})`
        : 'Store delay, customer unreachable, address issue',
      icon: '🛵',
      highlight: !!activeDelivery,
    },
    {
      id: 'PAYMENT_EARNINGS',
      title: 'Payment & Earnings',
      desc: 'Weekly settlement delays, missing delivery incentives, bank update',
      icon: '💰',
      highlight: false,
    },
    {
      id: 'ACCOUNT_KYC',
      title: 'Account & Verification',
      desc: 'Update Driving License, vehicle change, approval inquiry',
      icon: '📄',
      highlight: false,
    },
    {
      id: 'APP_PROBLEM',
      title: 'App / GPS Technical Problem',
      desc: 'Location tracking glitches, OTP delays, connection issues',
      icon: '🛠️',
      highlight: false,
    },
    {
      id: 'OTHER',
      title: 'General Support',
      desc: 'Other questions or feedback for operations team',
      icon: '💬',
      highlight: false,
    },
  ];

  const handleSelectCategory = (categoryId: string) => {
    router.push({
      pathname: '/support/new',
      params: {
        category: categoryId,
        jobId: activeDelivery?.jobId || undefined,
        orderReference: activeDelivery?.orderReference || undefined,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Captain Help &amp; Support</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Select a category below to connect with our Captain operations and dispatch desk.
        </Text>

        <View style={styles.list}>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={() => handleSelectCategory(cat.id)}
              style={[styles.card, cat.highlight && styles.cardHighlight]}
            >
              <Text style={styles.icon}>{cat.icon}</Text>
              <View style={styles.info}>
                <Text style={styles.cardTitle}>{cat.title}</Text>
                <Text style={styles.cardDesc}>{cat.desc}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
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
  subtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.md,
  },
  cardHighlight: {
    borderColor: palette.royalBlue,
    backgroundColor: '#F3F6FF',
  },
  icon: {
    fontSize: 24,
  },
  info: {
    flex: 1,
  },
  cardTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  cardDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  chevron: {
    fontSize: 24,
    color: palette.inkMuted,
  },
});
