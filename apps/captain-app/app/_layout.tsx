import { Stack } from 'expo-router'

export default function CaptainLayout() {
  return <Stack><Stack.Screen name="index" options={{ title: 'Captain' }} /><Stack.Screen name="inbox" options={{ title: 'Notifications' }} /></Stack>
}

