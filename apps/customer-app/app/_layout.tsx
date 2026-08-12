import { Stack } from 'expo-router'
import { CartProvider } from '../src/cartContext'

export default function CustomerLayout() {
  return (
    <CartProvider>
      <Stack screenOptions={{ animation: 'slide_from_right', headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="catalog" />
        <Stack.Screen name="shop" />
        <Stack.Screen name="grooming" />
        <Stack.Screen name="hospital" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="guide" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="otp" />
        <Stack.Screen name="cart" />
        <Stack.Screen name="inbox" />
      </Stack>
    </CartProvider>
  )
}
