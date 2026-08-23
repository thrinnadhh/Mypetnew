import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export interface DestinationParams {
  latitude?: number;
  longitude?: number;
  address?: string;
  label?: string;
}

export async function openDestinationNavigation(params: DestinationParams): Promise<void> {
  const { latitude, longitude, address, label } = params;

  if (latitude !== undefined && longitude !== undefined) {
    const latLng = `${latitude},${longitude}`;
    const encodedLabel = encodeURIComponent(label || 'Destination');

    if (Platform.OS === 'ios') {
      const appleMapsUrl = `maps:0,0?q=${encodedLabel}@${latLng}`;
      const canOpen = await Linking.canOpenURL(appleMapsUrl);
      if (canOpen) {
        await Linking.openURL(appleMapsUrl);
        return;
      }
    }

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latLng}`;
    await Linking.openURL(googleMapsUrl);
    return;
  }

  if (address) {
    const encodedAddress = encodeURIComponent(address);
    const googleSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    await Linking.openURL(googleSearchUrl);
  }
}
