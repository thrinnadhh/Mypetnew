import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { AppBar, EntityCard } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { spacing } from '@/design/tokens';

export default function AppointmentBookingScreen() {
  const router = useRouter();

  return (
    <ScreenShell
      header={<AppBar title="Book an appointment" subtitle="Choose veterinary care or grooming" />}
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
          subtitle="Find approved groomers, choose the service your pet needs and reserve an available slot."
          meta="Browse grooming appointments →"
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
