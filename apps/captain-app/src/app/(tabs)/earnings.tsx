import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaptainEarningsSummary } from '../../domain/earnings';
import { EmptyState } from '../../components/EmptyState';
import { MoneyAmount } from '../../components/MoneyAmount';
import { OfflineBanner } from '../../components/OfflineBanner';
import { RetryPanel } from '../../components/RetryPanel';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { earningsRepository } from '../../repositories/earnings-repository';
import { useCaptainStore } from '../../state/captain-store';

export default function EarningsTabScreen() {
  const { isNetworkConnected } = useCaptainStore();
  const [summary, setSummary] = useState<CaptainEarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await earningsRepository.getEarningsSummary();
      if (result.success) {
        setSummary(result.data);
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('Unable to load earnings. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const result = await earningsRepository.getEarningsSummary();
        if (!isMounted) return;
        if (result.success) {
          setSummary(result.data);
        } else {
          setError(result.error.message);
        }
      } catch {
        if (isMounted) {
          setError('Unable to load earnings. Please check your network connection.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Earnings &amp; Settlements</Text>
      </View>

      {!isNetworkConnected ? <OfflineBanner /> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={refreshing} />
        }
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={palette.royalBlue} size="large" />
            <Text style={styles.loadingText}>Loading earnings statement…</Text>
          </View>
        ) : error ? (
          <RetryPanel message={error} onRetry={loadData} />
        ) : (
          <>
            {/* Today's Earning Hero Card */}
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>TODAY&apos;S TOTAL EARNINGS</Text>
              <MoneyAmount
                paise={summary?.todayPaise || 0}
                style={styles.heroAmount}
              />
              <Text style={styles.heroSub}>
                {summary?.todayDeliveryCount || 0} deliveries completed today
              </Text>
            </View>

            {/* Weekly & Monthly Grid */}
            <View style={styles.grid}>
              <View style={styles.gridCard}>
                <Text style={styles.gridLabel}>THIS WEEK</Text>
                <MoneyAmount
                  paise={summary?.thisWeekPaise || 0}
                  style={styles.gridAmount}
                />
              </View>
              <View style={styles.gridCard}>
                <Text style={styles.gridLabel}>THIS MONTH</Text>
                <MoneyAmount
                  paise={summary?.thisMonthPaise || 0}
                  style={styles.gridAmount}
                />
              </View>
            </View>

            {/* Recent Order Earnings */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>RECENT EARNINGS</Text>
              {(!summary?.recentEarnings || summary.recentEarnings.length === 0) ? (
                <EmptyState
                  description="Completed delivery payouts will appear here once settled."
                  icon="💰"
                  title="No earnings recorded yet"
                />
              ) : (
                <View style={styles.list}>
                  {summary.recentEarnings.map((item) => (
                    <View key={item.deliveryId} style={styles.itemCard}>
                      <View>
                        <Text style={styles.itemRef}>{item.orderReference || `#${item.deliveryId.slice(0, 8)}`}</Text>
                        <Text style={styles.itemDate}>{item.completedAt}</Text>
                      </View>
                      <View style={styles.itemRight}>
                        <MoneyAmount paise={item.totalPaise} style={styles.itemAmount} />
                        <StatusBadge
                          label={item.status}
                          variant={item.status === 'SETTLED' ? 'online' : 'pending'}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Bank Settlements */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BANK SETTLEMENTS</Text>
              {(!summary?.settlements || summary.settlements.length === 0) ? (
                <View style={styles.payoutInfoCard}>
                  <Text style={styles.payoutInfoTitle}>Weekly Payout Schedule</Text>
                  <Text style={styles.payoutInfoDesc}>
                    All accumulated Captain delivery earnings are settled directly to your registered bank account every Tuesday.
                  </Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {summary.settlements.map((s) => (
                    <View key={s.settlementId} style={styles.itemCard}>
                      <View>
                        <Text style={styles.itemRef}>Weekly Settlement</Text>
                        <Text style={styles.itemDate}>
                          {s.periodStart} – {s.periodEnd}
                        </Text>
                      </View>
                      <View style={styles.itemRight}>
                        <MoneyAmount paise={s.amountPaise} style={styles.itemAmount} />
                        <StatusBadge label={s.status} variant="online" />
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
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
  heroCard: {
    backgroundColor: palette.royalBlue,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  heroLabel: {
    ...typography.caption,
    color: palette.royalBlueSoft,
    letterSpacing: 1,
    fontWeight: '800',
  },
  heroAmount: {
    ...typography.display,
    color: palette.white,
    fontSize: 36,
    marginVertical: spacing.xs,
  },
  heroSub: {
    ...typography.bodySmall,
    color: palette.royalBlueSoft,
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  gridCard: {
    flex: 1,
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.md,
  },
  gridLabel: {
    ...typography.caption,
    color: palette.inkMuted,
    marginBottom: 4,
  },
  gridAmount: {
    ...typography.title,
    color: palette.ink,
    fontSize: 18,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  itemRef: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  itemDate: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  itemRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  itemAmount: {
    color: palette.emerald,
    fontSize: 16,
    fontWeight: '700',
  },
  payoutInfoCard: {
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  payoutInfoTitle: {
    ...typography.label,
    color: palette.ink,
    marginBottom: 4,
  },
  payoutInfoDesc: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    lineHeight: 18,
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
