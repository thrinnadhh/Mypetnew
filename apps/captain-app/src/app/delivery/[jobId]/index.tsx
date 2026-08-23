import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, spacing, typography } from '../../../design/tokens';
import { useDeliveryStore } from '../../../state/delivery-store';

export default function DeliveryJobRouter() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery, restoreActiveDelivery } = useDeliveryStore();

  useEffect(() => {
    async function determineRoute() {
      let current = activeDelivery;
      if (!current || current.jobId !== jobId) {
        await restoreActiveDelivery();
      }

      if (!current) {
        router.replace('/(tabs)/home');
        return;
      }

      switch (current.state) {
        case 'ASSIGNED':
        case 'ARRIVING_PICKUP':
        case 'PICKUP_CONFIRMING':
          router.replace(`/delivery/${jobId}/pickup` as any);
          break;
        case 'PICKED_UP':
        case 'ARRIVING_CUSTOMER':
        case 'DELIVERY_CONFIRMING':
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
  }, [jobId, activeDelivery, restoreActiveDelivery]);

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
