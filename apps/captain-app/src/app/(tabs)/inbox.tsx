import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CaptainNotificationItem,
  fetchCaptainNotifications,
  markNotificationRead,
} from '../../api/notifications';
import { EmptyState } from '../../components/EmptyState';
import { OfflineBanner } from '../../components/OfflineBanner';
import { RetryPanel } from '../../components/RetryPanel';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { useCaptainStore } from '../../state/captain-store';
import { formatDateTime } from '../../utils/date';

export default function InboxTabScreen() {
  const { isNetworkConnected } = useCaptainStore();
  const [notifications, setNotifications] = useState<CaptainNotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    setError(null);
    try {
      const items = await fetchCaptainNotifications();
      setNotifications(items);
    } catch {
      setError('Unable to load inbox notifications. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadNotifications();
    } finally {
      setRefreshing(false);
    }
  };

  const handlePressItem = async (item: CaptainNotificationItem) => {
    if (!item.read) {
      // Optimistic mark read
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
      );
      try {
        await markNotificationRead(item.id);
      } catch {
        // Revert on failure
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read: false } : n)),
        );
      }
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'OFFER':
        return '🎁';
      case 'ASSIGNMENT':
        return '🛵';
      case 'KYC_UPDATE':
        return '📄';
      case 'SETTLEMENT':
        return '💰';
      case 'WARNING':
        return '⚠️';
      case 'ANNOUNCEMENT':
      default:
        return '📢';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox &amp; Alerts</Text>
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
            <Text style={styles.loadingText}>Loading notifications…</Text>
          </View>
        ) : error ? (
          <RetryPanel message={error} onRetry={loadNotifications} />
        ) : notifications.length === 0 ? (
          <EmptyState
            description="You will receive real-time updates regarding new orders, settlements, and compliance here."
            icon="🔔"
            title="You're all caught up"
          />
        ) : (
          <View style={styles.list}>
            {notifications.map((item) => (
              <TouchableOpacity
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.message}`}
                activeOpacity={0.8}
                onPress={() => handlePressItem(item)}
                style={[styles.itemCard, !item.read && styles.itemUnread]}
              >
                <Text style={styles.itemIcon}>{getNotificationIcon(item.type)}</Text>
                <View style={styles.itemContent}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    {!item.read ? <View style={styles.unreadDot} /> : null}
                  </View>
                  <Text style={styles.itemMessage}>{item.message}</Text>
                  <Text style={styles.itemTime}>{formatDateTime(item.createdAt)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
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
  list: {
    gap: spacing.sm,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: palette.white,
    padding: spacing.md,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.md,
  },
  itemUnread: {
    borderColor: palette.royalBlueSoft,
    backgroundColor: '#F3F6FF',
  },
  itemIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  itemContent: {
    flex: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  itemTitle: {
    ...typography.title,
    color: palette.ink,
    fontSize: 15,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.royalBlue,
  },
  itemMessage: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    lineHeight: 18,
  },
  itemTime: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: spacing.xs,
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
