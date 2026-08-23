import { router } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeliveryHistoryItem } from '../../api/deliveries';
import { ActiveDeliveryCard } from '../../components/ActiveDeliveryCard';
import { EmptyState } from '../../components/EmptyState';
import { MoneyAmount } from '../../components/MoneyAmount';
import { OfflineBanner } from '../../components/OfflineBanner';
import { RetryPanel } from '../../components/RetryPanel';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useDeliveryStore } from '../../state/delivery-store';
import { useCaptainStore } from '../../state/captain-store';
import { earningsRepository } from '../../repositories/earnings-repository';
import { formatDateTime } from '../../utils/date';

export default function DeliveriesTabScreen() {
  const { activeDelivery, restoreActiveDelivery } = useDeliveryStore();
  const { isNetworkConnected } = useCaptainStore();
  const [history, setHistory] = useState<DeliveryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      await restoreActiveDelivery();
      const result = await earningsRepository.getDeliveryHistory();
      if (result.success) {
        setHistory(result.data);
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('Unable to load deliveries. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  }, [restoreActiveDelivery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

      {!isNetworkConnected ? <OfflineBanner /> : null}

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

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={palette.royalBlue} size="large" />
              <Text style={styles.loadingText}>Loading delivery history…</Text>
            </View>
          ) : error ? (
            <RetryPanel
              message={error}
              onRetry={loadData}
            />
          ) : history.length === 0 ? (
            <EmptyState
              description="Completed and delivered orders will appear here once delivered."
              icon="📦"
              title="No deliveries yet"
            />
          ) : (
            <View style={styles.historyList}>
              {history.map((item) => (
                <View key={item.deliveryId} style={styles.historyCard}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.orderRef}>{item.orderReference || `#${item.orderId.slice(0, 8)}`}</Text>
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
  loadingContainer: {
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
  },
});
