import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { appConfig } from '@/utils/app-config';

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Push registration failed (${response.status})`);
}

export async function revokeDeviceRegistration(
  installationId: string,
  accessToken: string,
): Promise<void> {
  if (Platform.OS === 'web' || isExpoGo()) return;

  const url = `${appConfig.apiBaseUrl}/api/v1/devices/registrations/${installationId}?appKind=CUSTOMER&environment=${encodeURIComponent(appConfig.environment)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok && response.status !== 404) throw await responseError(response);
}
