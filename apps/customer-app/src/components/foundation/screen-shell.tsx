import type { PropsWithChildren, ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { spacing } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface ScreenShellProps extends PropsWithChildren {
  scroll?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
}

export function ScreenShell({
  children,
  scroll = true,
  header,
  footer,
  testID,
  contentContainerStyle,
  refreshControl,
}: ScreenShellProps) {
  const theme = useTheme();
  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: BottomTabInset + spacing.x8 },
        contentContainerStyle,
      ]}
    >
      <View style={styles.bounded}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.bounded, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']} testID={testID}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        {content}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing.x4, paddingTop: spacing.x4 },
  bounded: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: spacing.x6 },
});
