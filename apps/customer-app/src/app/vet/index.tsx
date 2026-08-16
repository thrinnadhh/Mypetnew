import React from 'react';

import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';

export default function VeterinaryDiscoveryRoute() {
  return (
    <AppointmentDiscoveryScreen
      providerType="VET_HOSPITAL"
      route="/vet"
      titleKey="appointmentFoundation.vetTitle"
    />
  );
}
