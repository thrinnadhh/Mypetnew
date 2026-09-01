import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export type PrimaryTabKey = 'home' | 'orders' | 'inventory' | 'catalog' | 'more';

export interface TabItemConfig {
  key: PrimaryTabKey;
  label: string;
  icon: string;
  badge?: number | string;
  accessibilityLabel: string;
}

export interface MoreMenuItemConfig {
  key: string;
  label: string;
  icon: string;
  subtitle?: string;
  badge?: number | string;
  onPress: () => void;
}

export interface BottomNavigationProps {
  activeTab: PrimaryTabKey;
  onTabPress: (key: PrimaryTabKey) => void;
  orderBadge?: number;
  moreMenuItems?: MoreMenuItemConfig[];
  style?: ViewStyle;
  testID?: string;
}

const DEFAULT_TABS: TabItemConfig[] = [
  { key: 'home', label: 'Home', icon: '🏠', accessibilityLabel: 'Home Dashboard tab' },
  { key: 'orders', label: 'Orders', icon: '📦', accessibilityLabel: 'Orders tab' },
  { key: 'inventory', label: 'Inventory', icon: '📊', accessibilityLabel: 'Inventory ledger tab' },
  { key: 'catalog', label: 'Catalog', icon: '🏷️', accessibilityLabel: 'Catalog products tab' },
  { key: 'more', label: 'More', icon: '☰', accessibilityLabel: 'More operations tab' },
];

export function BottomNavigation({
  activeTab,
  onTabPress,
  orderBadge = 0,
  moreMenuItems = [],
  style,
  testID = 'bottom-navigation',
}: BottomNavigationProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  function handlePress(key: PrimaryTabKey) {
    if (key === 'more') {
      if (moreMenuItems.length > 0) {
        setMoreMenuOpen(true);
      } else {
        onTabPress('more');
      }
      return;
    }
    onTabPress(key);
  }

  function handleMenuSelect(item: MoreMenuItemConfig) {
    setMoreMenuOpen(false);
    item.onPress();
  }

  return (
    <>
      <View style={[styles.bar, style]} testID={testID} accessibilityRole="tablist">
        {DEFAULT_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const badgeValue = tab.key === 'orders' ? orderBadge : tab.badge;

          return (
            <Pressable
              key={tab.key}
              onPress={() => handlePress(tab.key)}
              style={({ pressed }) => [
                styles.tabItem,
                isActive && styles.tabItemActive,
                pressed && styles.tabItemPressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab.accessibilityLabel}
              testID={`tab-${tab.key}`}
            >
              <View style={styles.iconWrapper}>
                <Text style={[styles.iconText, isActive && styles.iconTextActive]}>
                  {tab.icon}
                </Text>
                {Boolean(badgeValue && Number(badgeValue) > 0) && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {Number(badgeValue) > 99 ? '99+' : badgeValue}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.activeIndicator} />}
            </Pressable>
          );
        })}
      </View>

      {moreMenuItems.length > 0 && (
        <Modal
          visible={moreMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMoreMenuOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setMoreMenuOpen(false)}>
            <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.menuHeader}>
                <Text style={styles.menuTitle}>Merchant Operations</Text>
                <Pressable
                  onPress={() => setMoreMenuOpen(false)}
                  style={styles.menuCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close operations menu"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.menuCloseText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.menuGrid}>
                {moreMenuItems.map((item) => (
                  <Pressable
                    key={item.key}
                    onPress={() => handleMenuSelect(item)}
                    style={({ pressed }) => [
                      styles.menuItem,
                      pressed && styles.menuItemPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}${item.subtitle ? `, ${item.subtitle}` : ''}`}
                    testID={`more-menu-${item.key}`}
                  >
                    <View style={styles.menuItemIcon}>
                      <Text style={styles.menuItemIconText}>{item.icon}</Text>
                      {Boolean(item.badge && Number(item.badge) > 0) && (
                        <View style={styles.menuBadge}>
                          <Text style={styles.badgeText}>{item.badge}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.menuItemTextCol}>
                      <Text style={styles.menuItemLabel}>{item.label}</Text>
                      {item.subtitle && (
                        <Text style={styles.menuItemSubtitle}>{item.subtitle}</Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: spacing.bottomNavHeight,
    paddingHorizontal: spacing.xs,
  },
  tabItem: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    minWidth: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    position: 'relative',
    gap: 2,
  },
  tabItemActive: {
    backgroundColor: 'rgba(0, 97, 148, 0.05)',
    borderRadius: radius.md,
  },
  tabItemPressed: {
    opacity: 0.7,
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 20,
    color: colors.slate600,
  },
  iconTextActive: {
    color: colors.primary,
  },
  tabLabel: {
    ...typography.labelSm,
    fontSize: 11,
    fontWeight: '600',
    color: colors.slate600,
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 2,
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: colors.error,
    borderRadius: radius.full,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    maxHeight: '80%',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  menuTitle: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  menuCloseBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  menuCloseText: {
    fontSize: 18,
    color: colors.slate600,
    fontWeight: '700',
  },
  menuGrid: {
    gap: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.slate50,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.md,
    minHeight: spacing.touchTargetMin,
  },
  menuItemPressed: {
    backgroundColor: colors.slate100,
  },
  menuItemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  menuItemIconText: {
    fontSize: 20,
  },
  menuBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.error,
    borderRadius: radius.full,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemTextCol: {
    flex: 1,
    gap: 2,
  },
  menuItemLabel: {
    ...typography.labelLg,
    color: colors.slate900,
  },
  menuItemSubtitle: {
    ...typography.bodySm,
    color: colors.slate500,
  },
});
