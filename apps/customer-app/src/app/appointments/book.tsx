import { useRouter } from 'expo-router';
import React, { useCallback, useEffect } from 'react';
import { BackHandler, Platform, View } from 'react-native';

import { EntityCard } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ScreenHeader } from '@/components/ui/screen-header';
import { spacing } from '@/design/tokens';
import { backOrReplace } from '@/utils/customer-navigation-safety';

export default function AppointmentBookingScreen() {
  const router = useRouter();
  const handleBack = useCallback(() => {
    backOrReplace(router, '/appointments');
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) return false;
      router.replace('/appointments' as never);
      return true;
    });
    return () => subscription.remove();
  }, [router]);

  return (
    <ScreenShell
      header={(
        <ScreenHeader
          title="Book an appointment"
          subtitle="Choose veterinary care or grooming"
          onBack={handleBack}
        />
      )}
      testID="appointment-booking-screen"
    >
      <View style={{ gap: spacing.x3 }}>
        <EntityCard
          title="Veterinary care"
          subtitle="Find serviceable hospitals and clinics, choose a service and reserve an available slot."
          meta="Browse veterinary appointments →"
          icon="medical"
          onPress={() => router.push('/vet' as never)}
        />
        <EntityCard
          title="Grooming"
          subtitle="Browse live grooming services first, then choose the provider and slot that fits your pet."
          meta="Browse grooming services →"
          icon="groom"
          onPress={() => router.push('/groom' as never)}
        />
        <EntityCard
          title="My appointments"
          subtitle="Review upcoming and past appointments, provider confirmation, cancellation and visit details."
          meta="View appointment history →"
          icon="calendar"
          onPress={() => router.replace('/appointments' as never)}
        />
      </View>
    </ScreenShell>
  );
}
