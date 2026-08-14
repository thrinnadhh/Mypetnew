import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import fs from 'fs';
import path from 'path';

import {
  usePushNotifications,
  revokeDeviceRegistration,
  notificationIntent,
} from '@/hooks/usePushNotifications';
import { getOrCreateInstallationId } from '@/utils/installation-id';

jest.mock('expo-constants', () => ({
  appOwnership: 'standalone',
  easConfig: { projectId: 'test-project-id' },
  expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
}));

let pushTokenListenerCallback: ((token: { data: string }) => void) | null = null;

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn((cb: (token: { data: string }) => void) => {
    pushTokenListenerCallback = cb;
    return { remove: jest.fn() };
  }),
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

jest.mock('@/context/AuthIntentContext', () => ({
  useAuthIntent: () => ({
    requireAuth: jest.fn(() => Promise.resolve(true)),
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('usePushNotifications behavioral test suite', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    pushTokenListenerCallback = null;
    Platform.OS = 'android';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'reg-1', status: 'ACTIVE' }),
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, status: 'granted' });
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValue({
      type: 'fcm',
      data: 'native-fcm-token-123',
    });
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('A. configures Android channel BEFORE requesting permission or acquiring native token', async () => {
    const callOrder: string[] = [];

    (Notifications.setNotificationChannelAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('setNotificationChannelAsync');
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('requestPermissionsAsync');
      return { granted: true, status: 'granted' };
    });
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockImplementation(async () => {
      callOrder.push('getDevicePushTokenAsync');
      return { type: 'fcm', data: 'native-fcm-token-123' };
    });

    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(callOrder).toEqual([
      'setNotificationChannelAsync',
      'requestPermissionsAsync',
      'getDevicePushTokenAsync',
    ]);
  });

  it('B. GRANTED: acquires native FCM token and registers with canonical payload', async () => {
    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/devices/registrations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-1',
        }),
        body: JSON.stringify({
          appKind: 'CUSTOMER',
          environment: 'development',
          installationId: '123e4567-e89b-42d3-a456-426614174000',
          platform: 'ANDROID',
          nativeToken: 'native-fcm-token-123',
          permissionState: 'GRANTED',
        }),
      }),
    );
  });

  it('C. DENIED: sends DENIED registration without acquiring native FCM token', async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false, status: 'denied' });

    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/devices/registrations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          appKind: 'CUSTOMER',
          environment: 'development',
          installationId: '123e4567-e89b-42d3-a456-426614174000',
          platform: 'ANDROID',
          nativeToken: '',
          permissionState: 'DENIED',
        }),
      }),
    );
  });

  it('D. token rotation: addPushTokenListener re-registers rotated token without calling getDevicePushTokenAsync', async () => {
    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    expect(pushTokenListenerCallback).not.toBeNull();

    await TestRenderer.act(async () => {
      pushTokenListenerCallback!({ data: 'rotated-native-token-456' });
    });

    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:8080/api/v1/devices/registrations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          appKind: 'CUSTOMER',
          environment: 'development',
          installationId: '123e4567-e89b-42d3-a456-426614174000',
          platform: 'ANDROID',
          nativeToken: 'rotated-native-token-456',
          permissionState: 'GRANTED',
        }),
      }),
    );
  });

  it('E. session refresh device rebind: same user with new accessToken re-registers device', async () => {
    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    let root: any;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/devices/registrations',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-1' }),
      }),
    );

    await TestRenderer.act(async () => {
      root.update(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-2-refreshed' }));
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:8080/api/v1/devices/registrations',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-2-refreshed' }),
      }),
    );
  });

  it('F. iOS: APNs native token is NOT sent to direct FCM backend', async () => {
    Platform.OS = 'ios';
    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('G & H. web & Expo Go remain safe / no-op', async () => {
    Platform.OS = 'web';
    const React = require('react');
    const TestRenderer = require('react-test-renderer');

    function TestComponent({ userId, accessToken }: { userId: string; accessToken: string }) {
      usePushNotifications(userId, accessToken);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(TestComponent, { userId: 'user-1', accessToken: 'access-token-1' }));
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('I. logout: revokeDeviceRegistration calls DELETE with authenticated token', async () => {
    await revokeDeviceRegistration('123e4567-e89b-42d3-a456-426614174000', 'access-token-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/devices/registrations/123e4567-e89b-42d3-a456-426614174000?appKind=CUSTOMER&environment=development',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token-1' }),
      }),
    );
  });

  it('J. tap routing: maps canonical backend safe routes and rejects merchant/captain/arbitrary injection', () => {
    const validId = '123e4567-e89b-42d3-a456-426614174000';

    expect(notificationIntent({ route: 'customer/loyalty' })).toEqual({
      action: 'ORDER_HISTORY',
      returnTo: '/(tabs)/profile',
    });

    expect(notificationIntent({ route: 'inbox' })).toEqual({
      action: 'ORDER_HISTORY',
      returnTo: '/(tabs)/home',
    });

    expect(notificationIntent({ route: 'customer/orders/detail', resourceId: validId })).toEqual({
      action: 'ORDER_HISTORY',
      returnTo: `/orders/${validId}`,
    });

    expect(notificationIntent({ route: 'merchant/orders/detail', resourceId: validId })).toBeNull();
    expect(notificationIntent({ route: 'captain/dispatch', resourceId: validId })).toBeNull();
    expect(notificationIntent({ route: 'unknown/route' })).toBeNull();
    expect(notificationIntent({ route: 'https://evil.com' })).toBeNull();
    expect(notificationIntent({ route: '../admin' })).toBeNull();
    expect(notificationIntent({ route: 'customer/orders/detail', resourceId: 'invalid-id' })).toEqual({
      action: 'ORDER_HISTORY',
      returnTo: '/(tabs)/orders',
    });
  });

  it('source architecture regression check forbids legacy endpoints and getExpoPushTokenAsync', () => {
    const sourcePath = path.resolve(__dirname, '../usePushNotifications.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');

    expect(sourceCode).not.toContain('/api/v1/notifications/push-tokens');
    expect(sourceCode).not.toContain('getExpoPushTokenAsync');
    expect(sourceCode).toContain('/api/v1/devices/registrations');
    expect(sourceCode).toContain('getDevicePushTokenAsync');
  });
});
