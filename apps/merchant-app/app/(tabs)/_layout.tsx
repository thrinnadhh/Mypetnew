import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../../src/design/tokens';

function TabIcon({ label, focused, iconText }: { label: string; focused: boolean; iconText: string }) {
  return (
    <View style={styles.tabItem}>
      <Text style={[styles.iconText, focused && styles.iconTextFocused]}>{iconText}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>{label}</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => <TabIcon label="Dashboard" focused={focused} iconText="📊" />,
        }}
      />
      <Tabs.Screen
        name="pos"
        options={{
          title: 'POS Billing',
          tabBarIcon: ({ focused }) => <TabIcon label="POS Billing" focused={focused} iconText="⚡" />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused }) => <TabIcon label="Orders" focused={focused} iconText="📦" />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Care Bookings',
          tabBarIcon: ({ focused }) => <TabIcon label="Care" focused={focused} iconText="🐾" />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ focused }) => <TabIcon label="Inventory" focused={focused} iconText="📋" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 64,
    backgroundColor: palette.white,
    borderTopWidth: 1,
    borderTopColor: palette.outlineSoft,
    paddingTop: spacing.x1,
    paddingBottom: spacing.x2,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconText: {
    fontSize: 20,
    opacity: 0.6,
  },
  iconTextFocused: {
    opacity: 1,
  },
  tabLabel: {
    ...typography.caption,
    fontSize: 10,
    color: palette.inkMuted,
  },
  tabLabelFocused: {
    color: palette.royalBlue,
    fontWeight: '700',
  },
});
