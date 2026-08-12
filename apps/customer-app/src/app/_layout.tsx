import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthIntentProvider } from '@/context/AuthIntentContext';
import { CartProvider } from '@/context/CartContext';
import { FavouritesProvider } from '@/context/FavouritesContext';
import { LocaleProvider } from '@/context/LocaleContext';
import { LocationProvider } from '@/context/LocationContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import '@/i18n';

function AppNavigator() {
  const scheme = useColorScheme();
  const { loading, session, user } = useAuth();
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  usePushNotifications(user?.id, session?.access_token);

  if (loading || (!fontsLoaded && !fontError)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  }

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthIntentProvider>
        <LocationProvider>
          <CartProvider>
            <FavouritesProvider>
              <LocaleProvider>
                <AppNavigator />
              </LocaleProvider>
            </FavouritesProvider>
          </CartProvider>
        </LocationProvider>
      </AuthIntentProvider>
    </AuthProvider>
  );
}
