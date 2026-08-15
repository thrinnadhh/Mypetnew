import { Stack } from 'expo-router'

export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" options={{ title: 'MyPet' }} />
      <Stack.Screen name="otp" options={{ title: 'Verify mobile' }} />
      <Stack.Screen name="cart" options={{ title: 'Your cart' }} />
      <Stack.Screen name="inbox" options={{ title: 'Notifications' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Centre' }} />
    </Stack>
  )
}
