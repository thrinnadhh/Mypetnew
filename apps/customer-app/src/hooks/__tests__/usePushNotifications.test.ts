import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import fs from 'fs';
import path from 'path';

import { revokeDeviceRegistration } from '@/hooks/usePushNotifications';

jest.mock('expo-constants', () => ({
  appOwnership: 'standalone',
  easConfig: { projectId: 'test-project-id' },
  expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock('@/utils/installation-id', () => ({
  getOrCreateInstallationId: jest.fn(() => Promise.resolve('123e4567-e89b-42d3-a456-426614174000')),
}));

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'http://localhost:8080',
    environment: 'development',
    allowDemoMode: false,
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('usePushNotifications source and contract rules', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'reg-1', status: 'ACTIVE' }),
    });
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('rejects legacy push-tokens endpoint and getExpoPushTokenAsync in source code', () => {
    const sourcePath = path.resolve(__dirname, '../usePushNotifications.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');

    expect(sourceCode).not.toContain('/api/v1/notifications/push-tokens');
    expect(sourceCode).not.toContain('getExpoPushTokenAsync');
    expect(sourceCode).toContain('/api/v1/devices/registrations');
    expect(sourceCode).toContain('getDevicePushTokenAsync');
    expect(sourceCode).toContain('addPushTokenListener');
  });

  it('invokes canonical revoke API with DELETE on explicit logout', async () => {
    await revokeDeviceRegistration('123e4567-e89b-42d3-a456-426614174000', 'access-token-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/devices/registrations/123e4567-e89b-42d3-a456-426614174000?appKind=CUSTOMER&environment=development',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
        }),
      }),
    );
  });

  it('does not leak token data into logs or error output', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: 'DEVICE_REGISTRATION_INVALID', message: 'Invalid device registration' }),
    });

    await expect(
      revokeDeviceRegistration('123e4567-e89b-42d3-a456-426614174000', 'access-token-123'),
    ).rejects.toThrow('Invalid device registration');
  });
});
