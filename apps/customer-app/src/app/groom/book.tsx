import React from 'react';

import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';

export default function GroomingBookingRoute() {
  return (
    <AppointmentDiscoveryScreen
      providerType="GROOMER"
      route="/groom/book"
      titleKey="appointmentFoundation.groomTitle"
    />
  );
}
