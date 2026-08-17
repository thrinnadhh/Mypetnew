import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';
import GroomingServicesScreen from './grooming/index';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function GroomingRoute() {
  const params = useLocalSearchParams<{
    providerId?: string | string[];
    serviceId?: string | string[];
  }>();
  const providerId = single(params.providerId);
  const serviceId = single(params.serviceId);

  if (providerId || serviceId) {
    return (
      <AppointmentDiscoveryScreen
        providerType="GROOMER"
        route="/groom"
        titleKey="appointmentFoundation.groomTitle"
      />
    );
  }

  return <GroomingServicesScreen />;
}
