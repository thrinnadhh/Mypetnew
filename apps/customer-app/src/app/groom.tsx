import AppointmentDiscoveryScreen from '@/screens/appointment-discovery-screen';

export default function GroomScreen() {
  return (
    <AppointmentDiscoveryScreen
      providerType="GROOMER"
      route="/groom"
      titleKey="appointmentFoundation.groomTitle"
    />
  );
}
