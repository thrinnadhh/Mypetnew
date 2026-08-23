import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeliveryHistoryItem, fetchDeliveryHistory } from '../../api/deliveries';
import { ActiveDeliveryCard } from '../../components/ActiveDeliveryCard';
import { EmptyState } from '../../components/EmptyState';
import { MoneyAmount } from '../../components/MoneyAmount';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useDelivery } from '../../features/delivery/delivery-context';
import { formatDateTime } from '../../utils/date';

export default function DeliveriesTabScreen() {
  const { activeDelivery, restoreActiveDelivery } = useDelivery();
  const [history, setHistory] = useState<DeliveryHistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    await restoreActiveDelivery();
    const items = await fetchDeliveryHistory();
    setHistory(items);
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Deliveries</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} />
        }
      >
        {activeDelivery ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>ACTIVE DELIVERY</Text>
            <ActiveDeliveryCard
              delivery={activeDelivery}
              onContinue={() => router.push(`/delivery/${activeDelivery.jobId}` as any)}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>PAST DELIVERIES</Text>

          {history.length === 0 ? (
            <EmptyState
              description="Completed and delivered orders will appear here."
              icon="📦"
              title="No deliveries yet"
            />
          ) : (
            <View style={styles.historyList}>
              {history.map((item) => (
                <View key={item.deliveryId} style={styles.historyCard}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.orderRef}>{item.orderReference}</Text>
                      <Text style={styles.merchantName}>{item.merchantName}</Text>
                    </View>
                    <StatusBadge
                      label={item.status === 'DELIVERED' ? 'DELIVERED' : 'CANCELLED'}
                      variant={item.status === 'DELIVERED' ? 'delivered' : 'neutral'}
                    />
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.dateText}>{formatDateTime(item.deliveredAt)}</Text>
                    <MoneyAmount paise={item.earningPaise} style={styles.earningText} />
                  </View>
                </View>
              ))}
            </View>
          )}
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
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeading: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  historyList: {
    gap: spacing.sm,
  },
  historyCard: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  orderRef: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  merchantName: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: palette.outlineSoft,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  dateText: {
    ...typography.caption,
    color: palette.inkMuted,
  },
  earningText: {
    color: palette.emerald,
    fontSize: 16,
    fontWeight: '700',
  },
});
