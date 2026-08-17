import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { radii, shadows, spacing } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import AppointmentsScreen from '@/screens/appointments-screen';

export default function AppointmentsRoute() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <AppointmentsScreen />
      <Pressable
        testID="book-appointment-action"
        accessibilityRole="button"
        accessibilityLabel="Book a new appointment"
        onPress={() => router.push('/appointments/book' as never)}
        style={({ pressed }) => [
          styles.bookingAction,
          shadows.raised,
          { backgroundColor: theme.cta },
          pressed && styles.pressed,
        ]}
      >
        <AppIcon name="calendar" size={20} color="#FFFFFF" />
        <ThemedText style={styles.bookingActionText}>Book appointment</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bookingAction: {
    position: 'absolute',
    right: spacing.x4,
    bottom: spacing.x4,
    minHeight: 48,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
  },
  bookingActionText: { color: '#FFFFFF', fontWeight: '800' },
  pressed: { opacity: 0.86 },
});
