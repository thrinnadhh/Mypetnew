import { Tabs } from 'expo-router';

import { AppIcon } from '@/components/app-icon';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { CUSTOMER_TABS } from '@/navigation/customer-navigation';

export default function AppTabs() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.backgroundElement, borderTopColor: theme.border, minHeight: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarHideOnKeyboard: true,
      }}
    >
      {CUSTOMER_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.labelKey),
            tabBarAccessibilityLabel: t(tab.labelKey),
            tabBarIcon: ({ color, size }) => <AppIcon name={tab.icon} color={typeof color === 'string' ? color : theme.primary} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
