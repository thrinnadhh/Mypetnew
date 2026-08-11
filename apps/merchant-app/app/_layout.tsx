import { Stack } from 'expo-router'

export default function MerchantLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="index" options={{ title: 'Merchant' }} />
      <Stack.Screen name="scanner" options={{ title: 'Barcode scanner' }} />
      <Stack.Screen name="inventory" options={{ title: 'Inventory' }} />
      <Stack.Screen name="pos" options={{ title: 'POS' }} />
      <Stack.Screen name="orders" options={{ title: 'Pickup orders' }} />
      <Stack.Screen name="inbox" options={{ title: 'Notifications' }} />
    </Stack>
  )
}

