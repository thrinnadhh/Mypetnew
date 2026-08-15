import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';

/**
 * Compatibility route for older links that still target /grooming.
 * Keep both /groom and /grooming on the canonical live booking pipeline so
 * customers never fall back to a static catalogue or a navigation loop.
 */
export default function GroomingServicesScreen() {
  return (
    <AppointmentDiscoveryScreen
      providerType="GROOMER"
      route="/groom"
      titleKey="appointmentFoundation.groomTitle"
    />
  );
}
