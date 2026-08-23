import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

interface MerchantHeaderProps {
  title?: string;
  outletName?: string;
  outletId?: string;
  cashierName?: string;
  isOpen?: boolean;
}

export function MerchantHeader({
  title,
  outletName = 'Paws & Bubbles Care & Pet Store',
  outletId = '#OUT-1029',
  cashierName = 'Staff: Ramesh K. (Cashier)',
  isOpen = true,
}: MerchantHeaderProps) {
  return (
    <View style={styles.header}>
      {title ? <Text style={styles.pageTitle}>{title}</Text> : null}
      <View style={styles.outletRow}>
        <View style={styles.outletInfo}>
          <Text style={styles.outletName} numberOfLines={1}>
            {outletName}
          </Text>
          <Text style={styles.outletId}>{outletId}</Text>
        </View>
        <View style={[styles.statusPill, isOpen ? styles.statusOpen : styles.statusClosed]}>
          <View style={[styles.dot, isOpen ? styles.dotOpen : styles.dotClosed]} />
          <Text style={[styles.statusText, isOpen ? styles.statusTextOpen : styles.statusTextClosed]}>
            {isOpen ? 'Open' : 'Closed'}
          </Text>
        </View>
      </View>
      <View style={styles.staffRow}>
        <Text style={styles.staffText}>{cashierName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.x4,
    paddingTop: spacing.x3,
    paddingBottom: spacing.x3,
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
    gap: spacing.x2,
  },
  pageTitle: {
    ...typography.headline,
    color: palette.ink,
  },
  outletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.x2,
  },
  outletInfo: {
    flex: 1,
  },
  outletName: {
    ...typography.title,
    color: palette.ink,
  },
  outletId: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    gap: spacing.x1,
  },
  statusOpen: {
    backgroundColor: palette.emeraldSoft,
  },
  statusClosed: {
    backgroundColor: palette.errorSoft,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  dotOpen: {
    backgroundColor: palette.emerald,
  },
  dotClosed: {
    backgroundColor: palette.error,
  },
  statusText: {
    ...typography.caption,
    fontWeight: '700',
  },
  statusTextOpen: {
    color: palette.emerald,
  },
  statusTextClosed: {
    color: palette.error,
  },
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  staffText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
  },
});
