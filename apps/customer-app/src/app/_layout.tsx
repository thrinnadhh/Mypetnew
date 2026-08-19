import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useSegments } from 'expo-router';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { StateView } from '@/components/foundation/primitives';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthIntentProvider, useAuthIntent } from '@/context/AuthIntentContext';
import { CartProvider } from '@/context/CartContext';
import { FavouritesProvider } from '@/context/FavouritesContext';
import { LocaleProvider } from '@/context/LocaleContext';
import { LocationProvider, useLocation } from '@/context/LocationContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import '@/i18n';

function isCommerceDiscoveryRoute(segments: readonly string[]): boolean {
  const visible = segments.filter((segment) => !segment.startsWith('('));
  const path = visible.join('/');
  return (
    path === 'stores'
    || path === 'products'
    || path === 'search'
    || path === 'shop'
    || path.startsWith('shop/')
    || path === 'category'
    || path.startsWith('category/')
    || path === 'commerce'
    || path.startsWith('commerce/')
  );
}

function AppNavigator() {
  const scheme = useColorScheme();
  const segments = useSegments();
  const { loading, session, user } = useAuth();
  const { requireAuth } = useAuthIntent();
  const {
    loading: locationLoading,
    selectedPincode,
    serviceRegionError,
    refreshCities,
  } = useLocation();
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  usePushNotifications(user?.id, session?.accessToken, requireAuth);

  if (loading || (!fontsLoaded && !fontError)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  }

  const commerceRoute = isCommerceDiscoveryRoute(segments);
  const validServicePincode = /^[1-9][0-9]{5}$/.test(selectedPincode);
  const serviceabilityUnavailable = commerceRoute && (serviceRegionError || !validServicePincode);
  const accountNavigationKey = user?.id ?? 'guest';

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {commerceRoute && locationLoading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <StateView
            kind="loading"
            title="Loading serviceability"
            message="Checking active service regions before loading live commerce."
          />
        </View>
      ) : serviceabilityUnavailable ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <StateView
            kind="error"
            title="Service regions unavailable"
            message="Live serviceability could not be loaded. MyPet will not substitute a demo city or PIN."
            actionLabel="Retry"
            onAction={() => void refreshCities()}
          />
        </View>
      ) : (
        <Stack key={accountNavigationKey} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ presentation: 'modal' }} />
        </Stack>
      )}
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
