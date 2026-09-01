import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../tokens';
import { BottomNavigation, BottomNavigationProps, PrimaryTabKey } from './BottomNavigation';
import { MerchantHeader, MerchantHeaderProps } from './MerchantHeader';
import { OfflineBanner, OfflineBannerProps } from './OfflineBanner';

export interface MerchantScreenProps {
  children: React.ReactNode;
  headerProps?: MerchantHeaderProps;
  showHeader?: boolean;
  bottomNavProps?: BottomNavigationProps;
  showBottomNav?: boolean;
  offlineBannerProps?: OfflineBannerProps;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  safeAreaEdges?: Edge[];
  contentContainerStyle?: ViewStyle;
  style?: ViewStyle;
  testID?: string;
}

export function MerchantScreen({
  children,
  headerProps,
  showHeader = true,
  bottomNavProps,
  showBottomNav = false,
  offlineBannerProps,
  scrollable = true,
  refreshing = false,
  onRefresh,
  safeAreaEdges = ['top', 'left', 'right', 'bottom'],
  contentContainerStyle,
  style,
  testID = 'merchant-screen',
}: MerchantScreenProps) {
  const content = scrollable ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        ) : undefined
      }
      keyboardShouldPersistTaps="handled"
    >
      {offlineBannerProps && <OfflineBanner {...offlineBannerProps} style={styles.bannerSpacing} />}
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixedContent, contentContainerStyle]}>
      {offlineBannerProps && <OfflineBanner {...offlineBannerProps} style={styles.bannerSpacing} />}
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={safeAreaEdges} style={[styles.safeArea, style]} testID={testID}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {showHeader && headerProps && <MerchantHeader {...headerProps} />}
        <View style={styles.body}>{content}</View>
        {showBottomNav && bottomNavProps && <BottomNavigation {...bottomNavProps} />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceDim,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  fixedContent: {
    flex: 1,
    padding: spacing.md,
  },
  bannerSpacing: {
    marginBottom: spacing.xs,
  },
});
