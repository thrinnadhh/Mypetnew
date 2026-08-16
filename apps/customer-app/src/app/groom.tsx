import React from 'react';

import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';

export default function GroomingDiscoveryRoute() {
  return (
    <AppointmentDiscoveryScreen
      providerType="GROOMER"
      route="/groom"
      titleKey="appointmentFoundation.groomTitle"
    />
  );
}
