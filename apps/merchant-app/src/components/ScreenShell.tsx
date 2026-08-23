import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, ViewStyle } from 'react-native';
import { theme } from '../design/tokens';

interface ScreenShellProps {
  children: React.ReactNode;
  style?: ViewStyle;
  header?: React.ReactNode;
}

export function ScreenShell({ children, style, header }: ScreenShellProps) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      {header}
      <View style={[styles.content, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    flex: 1,
  },
});
