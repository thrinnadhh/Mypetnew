import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';
import { IconButton } from './IconButton';
import { OutletOption, OutletPickerModal } from './OutletPickerModal';
import { SyncIndicator, SyncStateMode } from './SyncIndicator';

export interface MerchantHeaderProps {
  outletName?: string;
  businessName?: string;
  outlets?: OutletOption[];
  selectedOutletId?: string;
  onSelectOutlet?: (outletId?: string) => void;
  syncMode?: SyncStateMode;
  pendingSyncCount?: number;
  onSyncPress?: () => void;
  unreadNotifications?: number;
  onNotificationsPress?: () => void;
  onAccountPress?: () => void;
  style?: ViewStyle;
  testID?: string;
}

export function MerchantHeader({
  outletName = 'All Outlets',
  businessName = 'MyPet Merchant',
  outlets = [],
  selectedOutletId,
  onSelectOutlet,
  syncMode = 'online',
  pendingSyncCount = 0,
  onSyncPress,
  unreadNotifications = 0,
  onNotificationsPress,
  onAccountPress,
  style,
  testID = 'merchant-header',
}: MerchantHeaderProps) {
  const [pickerVisible, setPickerVisible] = useState(false);

  const canSwitchOutlets = outlets.length > 0 && Boolean(onSelectOutlet);

  return (
    <View style={[styles.header, style]} testID={testID}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => canSwitchOutlets && setPickerVisible(true)}
          disabled={!canSwitchOutlets}
          style={({ pressed }) => [
            styles.outletSelector,
            canSwitchOutlets && styles.outletSelectorActionable,
            pressed && canSwitchOutlets && styles.outletSelectorPressed,
          ]}
          accessibilityRole={canSwitchOutlets ? 'button' : 'text'}
          accessibilityLabel={`Active Outlet: ${outletName}. Business: ${businessName}`}
          testID="outlet-selector-button"
        >
          <View style={styles.outletTextColumn}>
            <Text style={styles.businessTitle} numberOfLines={1}>{businessName}</Text>
            <View style={styles.outletRow}>
              <Text style={styles.outletTitle} numberOfLines={1}>{outletName}</Text>
              {canSwitchOutlets && (
                <Text style={styles.chevron}>▾</Text>
              )}
            </View>
          </View>
        </Pressable>

        <View style={styles.actionsGroup}>
          <SyncIndicator
            mode={syncMode}
            pendingCount={pendingSyncCount}
            onPress={onSyncPress}
            compact
          />

          {onNotificationsPress && (
            <IconButton
              icon="🔔"
              onPress={onNotificationsPress}
              badgeCount={unreadNotifications}
              accessibilityLabel={`Notifications inbox, ${unreadNotifications} unread`}
              testID="header-notifications-button"
            />
          )}

          {onAccountPress && (
            <IconButton
              icon="👤"
              onPress={onAccountPress}
              accessibilityLabel="Account and session settings"
              testID="header-account-button"
            />
          )}
        </View>
      </View>

      {canSwitchOutlets && onSelectOutlet && (
        <OutletPickerModal
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          outlets={outlets}
          selectedOutletId={selectedOutletId}
          onSelectOutlet={onSelectOutlet}
          businessName={businessName}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: spacing.headerHeight,
  },
  outletSelector: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    minHeight: spacing.touchTargetMin,
  },
  outletSelectorActionable: {
    backgroundColor: colors.slate50,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.sm,
  },
  outletSelectorPressed: {
    backgroundColor: colors.slate100,
  },
  outletTextColumn: {
    flex: 1,
    gap: 1,
  },
  businessTitle: {
    ...typography.bodySm,
    color: colors.slate500,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  outletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  outletTitle: {
    ...typography.labelLg,
    color: colors.slate900,
    fontWeight: '800',
  },
  chevron: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '800',
  },
  actionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
