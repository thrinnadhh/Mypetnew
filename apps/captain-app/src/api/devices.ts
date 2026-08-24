import { Platform } from 'react-native';
import { getCachedInstallationDeviceId, getInstallationDeviceId } from '../auth/session';
import { AppError } from '../domain/result';
import { captainApiFetch, handleApiResponse } from './client';

export type CaptainNotificationPermission = 'GRANTED' | 'DENIED';

function captainEnvironment(): 'development' | 'staging' | 'production' {
  const value = process.env.EXPO_PUBLIC_APP_ENV?.trim().toLowerCase() || 'development';
  if (value === 'development' || value === 'staging' || value === 'production') return value;
  throw new AppError({
    kind: 'ValidationRejected',
    code: 'INVALID_APP_ENVIRONMENT',
    message: 'EXPO_PUBLIC_APP_ENV must be development, staging, or production',
    status: 400,
  });
}

function nativePlatform(): 'ANDROID' | 'IOS' {
  if (Platform.OS === 'android') return 'ANDROID';
  if (Platform.OS === 'ios') return 'IOS';
  throw new AppError({
    kind: 'ValidationRejected',
    code: 'PUSH_PLATFORM_UNSUPPORTED',
    message: 'Native push registration is supported only on Android and iOS',
    status: 400,
  });
}

export async function registerCaptainDevice(
  nativeToken: string,
  permissionState: CaptainNotificationPermission,
): Promise<void> {
  const response = await captainApiFetch('/api/v1/devices/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appKind: 'CAPTAIN',
      environment: captainEnvironment(),
      installationId: await getInstallationDeviceId(),
      platform: nativePlatform(),
      nativeToken: permissionState === 'GRANTED' ? nativeToken : '',
      permissionState,
    }),
    timeoutMs: 8_000,
  });
  await handleApiResponse(response);
}

export async function revokeCaptainDevice(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  // Logout invalidates credentials immediately after dispatching cleanup. Use the
  // installation cached during login/bootstrap so the authenticated DELETE begins
  // before that invalidation instead of resuming from a SecureStore await afterward.
  const installationId = getCachedInstallationDeviceId();
  if (!installationId) return;
  const query = new URLSearchParams({
    appKind: 'CAPTAIN',
    environment: captainEnvironment(),
  });
  const response = await captainApiFetch(
    `/api/v1/devices/registrations/${installationId}?${query.toString()}`,
    { method: 'DELETE', timeoutMs: 5_000 },
  );
  await handleApiResponse(response);
}
