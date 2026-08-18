import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';
import VeterinaryDiscoveryScreen from '@/screens/veterinary-discovery-screen';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function VetScreen() {
  const params = useLocalSearchParams<{
    providerId?: string | string[];
    serviceId?: string | string[];
    slotId?: string | string[];
  }>();
  const providerId = single(params.providerId);
  const serviceId = single(params.serviceId);
  const slotId = single(params.slotId);

  // Parameterized /vet remains the existing P12-compatible booking handoff.
  // Plain /vet is now P11 provider-first veterinary discovery.
  if (providerId || serviceId || slotId) {
    return (
      <AppointmentDiscoveryScreen
        providerType="VET_HOSPITAL"
        route="/vet"
        titleKey="appointmentFoundation.vetTitle"
      />
    );
  }

  return <VeterinaryDiscoveryScreen />;
}
