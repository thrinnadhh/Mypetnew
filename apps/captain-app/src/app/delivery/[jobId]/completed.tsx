import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { MoneyAmount } from '../../../components/MoneyAmount';
import { palette, radii, spacing, typography } from '../../../design/tokens';
import { useDeliveryStore } from '../../../state/delivery-store';
import { formatTime } from '../../../utils/date';

export default function DeliveryCompletedScreen() {
  const { activeDelivery, restoreActiveDelivery } = useDeliveryStore();

  const handleReturnHome = async () => {
    await restoreActiveDelivery();
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkIcon}>✓</Text>
        </View>

        <Text style={styles.title}>DELIVERY COMPLETE</Text>
        <Text style={styles.orderRef}>
          {activeDelivery?.orderReference || (activeDelivery ? `#${activeDelivery.orderId.slice(0, 8)}` : 'Completed Delivery')}
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivered At:</Text>
            <Text style={styles.summaryVal}>
              {formatTime(activeDelivery?.deliveredAt || new Date().toISOString())}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.earningRow}>
            <Text style={styles.earningLabel}>Captain Earning:</Text>
            {activeDelivery?.earningPaise !== undefined && activeDelivery?.earningPaise !== null ? (
              <MoneyAmount
                paise={activeDelivery.earningPaise}
                style={styles.earningVal}
              />
            ) : (
              <Text style={styles.earningVal}>Settlement Pending</Text>
            )}
          </View>
        </View>

        <Text style={styles.note}>
          This delivery has been recorded. Your earnings will be processed in the next settlement cycle.
        </Text>

        <Button
          onPress={handleReturnHome}
          style={styles.homeBtn}
          title="BACK TO DASHBOARD"
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: palette.emerald,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  checkIcon: {
    fontSize: 44,
    color: palette.white,
    fontWeight: '800',
  },
  title: {
    ...typography.display,
    color: palette.emerald,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  orderRef: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    marginTop: 4,
    marginBottom: spacing.xl,
  },
  summaryCard: {
    width: '100%',
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
    marginVertical: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    ...typography.body,
    color: palette.inkMuted,
  },
  summaryVal: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: palette.outlineSoft,
    marginVertical: spacing.md,
  },
  earningRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  earningLabel: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 16,
  },
  earningVal: {
    color: palette.emerald,
    fontSize: 22,
    fontWeight: '800',
  },
  note: {
    ...typography.caption,
    color: palette.inkMuted,
    textAlign: 'center',
    marginVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    lineHeight: 16,
  },
  homeBtn: {
    marginTop: spacing.sm,
  },
});
