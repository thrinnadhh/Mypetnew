import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { type InventoryBalance } from '../../inventory/api';
import { colors, radius, spacing, typography } from '../tokens';
import { SecondaryButton } from './SecondaryButton';
import { StatusBadge, type StatusVariant } from './StatusBadge';

export type InventorySyncState = 'Canonical' | 'Cached' | 'Pending sync' | 'Syncing' | 'Rejected';

export interface InventoryCardProps {
  balance: InventoryBalance;
  listingName: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  lowStockThreshold?: number;
  syncStatus?: InventorySyncState;
  onAdjust: () => void;
  onReceive: () => void;
  onMoreOps: () => void;
  onViewLedger?: () => void;
  canWrite?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function getStockStatus(available: number, threshold = 5): { label: string; variant: StatusVariant } {
  if (available <= 0) {
    return { label: 'Out of Stock', variant: 'error' };
  }
  if (available <= threshold) {
    return { label: 'Low Stock', variant: 'warning' };
  }
  return { label: 'In Stock', variant: 'success' };
}

export function getSyncBadgeVariant(syncStatus: InventorySyncState): StatusVariant {
  switch (syncStatus) {
    case 'Canonical':
      return 'success';
    case 'Cached':
      return 'neutral';
    case 'Pending sync':
      return 'pending';
    case 'Syncing':
      return 'syncing';
    case 'Rejected':
      return 'error';
    default:
      return 'neutral';
  }
}

export function InventoryCard({
  balance,
  listingName,
  sku,
  barcode,
  category,
  lowStockThreshold = 5,
  syncStatus = 'Canonical',
  onAdjust,
  onReceive,
  onMoreOps,
  onViewLedger,
  canWrite = true,
  style,
  testID,
}: InventoryCardProps) {
  const stockStatus = getStockStatus(balance.available, lowStockThreshold);
  const syncVariant = getSyncBadgeVariant(syncStatus);

  return (
    <View
      style={[
        styles.card,
        syncStatus === 'Pending sync' && styles.cardPending,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Product ${listingName}, on hand ${balance.onHand}, available ${balance.available}, status ${stockStatus.label}`}
      testID={testID}
    >
      {/* Top Identity Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>{listingName}</Text>
          <View style={styles.metaRow}>
            {category ? (
              <View style={styles.categoryChip}>
                <Text style={styles.categoryText}>{category}</Text>
              </View>
            ) : null}
            {sku ? (
              <Text style={styles.skuText}>SKU: {sku}</Text>
            ) : null}
            {barcode ? (
              <Text style={styles.barcodeText}>Barcode: {barcode}</Text>
            ) : null}
          </View>
        </View>

        <StatusBadge
          label={stockStatus.label}
          variant={stockStatus.variant}
          testID={testID ? `${testID}-stock-badge` : undefined}
        />
      </View>

      {/* Stock Metrics 3-Col Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCell}>
          <Text style={styles.metricLabel}>On Hand</Text>
          <Text style={styles.metricValue}>{balance.onHand}</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCell}>
          <Text style={styles.metricLabel}>Reserved</Text>
          <Text style={[styles.metricValue, balance.reserved > 0 && styles.reservedValue]}>
            {balance.reserved}
          </Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricCell}>
          <Text style={styles.metricLabel}>Available</Text>
          <Text
            style={[
              styles.metricValue,
              balance.available <= 0
                ? styles.outOfStockValue
                : balance.available <= lowStockThreshold
                ? styles.lowStockValue
                : styles.availableValue,
            ]}
          >
            {balance.available}
          </Text>
        </View>
      </View>

      {/* Sync Status Banner */}
      <View style={styles.syncRow}>
        <View style={styles.syncPill}>
          <Text style={styles.syncLabel}>Data Source:</Text>
          <StatusBadge label={syncStatus} variant={syncVariant} />
        </View>

        {onViewLedger ? (
          <Pressable
            onPress={onViewLedger}
            style={styles.ledgerBtn}
            accessibilityRole="button"
            accessibilityLabel="View stock ledger movements"
          >
            <Text style={styles.ledgerBtnText}>Ledger History →</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Operations Action Bar */}
      {canWrite ? (
        <View style={styles.actionsRow}>
          <SecondaryButton
            title="Adjust"
            onPress={onAdjust}
            style={styles.actionBtn}
            testID={testID ? `${testID}-adjust-btn` : undefined}
          />
          <SecondaryButton
            title="+ Receive"
            onPress={onReceive}
            style={styles.actionBtn}
            testID={testID ? `${testID}-receive-btn` : undefined}
          />
          <SecondaryButton
            title="More…"
            onPress={onMoreOps}
            style={styles.moreBtn}
            testID={testID ? `${testID}-more-btn` : undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.cardPadding,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardPending: {
    borderStyle: 'dashed',
    borderColor: colors.pendingSync,
    backgroundColor: '#fffdfa',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  titleGroup: {
    flex: 1,
    gap: spacing.base,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryChip: {
    backgroundColor: colors.slate100,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  categoryText: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate700,
    fontWeight: '600',
  },
  skuText: {
    ...typography.codeSm,
    color: colors.slate600,
  },
  barcodeText: {
    ...typography.codeSm,
    color: colors.slate500,
  },
  metricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  metricCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  metricDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  metricLabel: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate600,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  metricValue: {
    ...typography.headlineMd,
    fontWeight: '800',
  },
  availableValue: {
    color: colors.success,
  },
  lowStockValue: {
    color: colors.warning,
  },
  outOfStockValue: {
    color: colors.error,
  },
  reservedValue: {
    color: colors.info,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  syncLabel: {
    ...typography.bodySm,
    color: colors.slate500,
    fontSize: 11,
  },
  ledgerBtn: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  ledgerBtnText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
  },
  moreBtn: {
    flex: 0.8,
    minHeight: spacing.touchTargetMin,
  },
});
