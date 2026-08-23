import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, spacing, typography } from '../../../design/tokens';
import { useDelivery } from '../../../features/delivery/delivery-context';

export default function DeliveryJobRouter() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery, restoreActiveDelivery } = useDelivery();

  useEffect(() => {
    async function determineRoute() {
      let current = activeDelivery;
      if (!current || current.jobId !== jobId) {
        current = await restoreActiveDelivery();
      }

      if (!current) {
        router.replace('/(tabs)/home');
        return;
      }

      switch (current.dispatchStatus) {
        case 'ASSIGNED':
          router.replace(`/delivery/${jobId}/pickup` as any);
          break;
        case 'PICKED_UP':
          router.replace(`/delivery/${jobId}/customer` as any);
          break;
        case 'DELIVERED':
          router.replace(`/delivery/${jobId}/completed` as any);
          break;
        default:
          router.replace('/(tabs)/home');
          break;
      }
    }

    determineRoute();
  }, [jobId, activeDelivery]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator color={palette.royalBlue} size="large" />
        <Text style={styles.text}>Connecting to delivery dispatch…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  text: {
    ...typography.body,
    color: palette.inkMuted,
  },
});
