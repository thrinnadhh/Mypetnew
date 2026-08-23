import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: "MyPet Merchant" }} />
        <Stack.Screen name="login" options={{ title: "Merchant sign in" }} />
      </Stack>
    </>
  );
}
