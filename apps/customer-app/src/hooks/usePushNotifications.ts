import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';

import type { AuthIntent } from '@/auth/auth-intent';
import { isUuid } from '@/utils/uuid';
import { ApiError, apiClient } from '@/services/api-client';
import { appConfig } from '@/utils/app-config';
import { getOrCreateInstallationId } from '@/utils/installation-id';

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

let handlerConfigured = false;

function getNotificationsModule() {
  if (Platform.OS === 'web' || isExpoGo()) return null;

  if (!handlerConfigured && typeof Notifications.setNotificationHandler === 'function') {
    handlerConfigured = true;
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    } catch (error) {
      console.warn('Unable to initialize notification handler', error);
    }
  }

  return Notifications;
}

export async function revokeDeviceRegistration(
  installationId: string,
  accessToken: string,
): Promise<void> {
  if (Platform.OS === 'web' || isExpoGo()) return;

  try {
    await apiClient.delete(
      `/api/v1/devices/registrations/${installationId}?appKind=CUSTOMER&environment=${encodeURIComponent(appConfig.environment)}`,
      undefined,
      { authToken: accessToken, errorFallback: 'Push registration revoke failed' },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

async function registerDeviceRegistration(
  accessToken: string,
  overrideNativeToken?: string,
): Promise<string | null> {
  if (Platform.OS === 'web' || isExpoGo()) return null;
  if (Platform.OS !== 'android') return null;

  const NotificationsMod = getNotificationsModule();
  if (!NotificationsMod) return null;
  if (!Device.isDevice) return null;

  const installationId = await getOrCreateInstallationId();

  // Android 13+: Channel MUST be configured BEFORE requesting notification permission.
  await NotificationsMod.setNotificationChannelAsync('customer-reminders', {
    name: 'Pet care reminders',
    importance: NotificationsMod.AndroidImportance.HIGH,
    sound: 'default',
  });

  const permission = await NotificationsMod.requestPermissionsAsync();

  if (!permission.granted) {
    await apiClient.post('/api/v1/devices/registrations', {
      appKind: 'CUSTOMER',
      environment: appConfig.environment,
      installationId,
      platform: 'ANDROID',
      nativeToken: '',
      permissionState: 'DENIED',
    }, undefined, { authToken: accessToken, errorFallback: 'Push registration failed' });
    return null;
  }

  let token = overrideNativeToken;
  if (!token) {
    const tokenResponse = await NotificationsMod.getDevicePushTokenAsync();
    token = typeof tokenResponse.data === 'string' ? tokenResponse.data.trim() : '';
  }

  if (!token || token.length > 4096) return null;

  await apiClient.post('/api/v1/devices/registrations', {
    appKind: 'CUSTOMER',
    environment: appConfig.environment,
    installationId,
    platform: 'ANDROID',
    nativeToken: token,
    permissionState: 'GRANTED',
  }, undefined, { authToken: accessToken, errorFallback: 'Push registration failed' });
  return token;
}

export function notificationIntent(data: Record<string, unknown>): AuthIntent | null {
  const route = typeof data.route === 'string' ? data.route.trim().toLowerCase() : '';

  if (!route) return null;

  if (
    route.startsWith('merchant/') ||
    route.startsWith('captain/') ||
    route.startsWith('admin/') ||
    route.includes('://') ||
    route.includes('..') ||
    route.startsWith('/')
  ) {
    return null;
  }

  if (route === 'customer/loyalty') {
    return { action: 'ORDER_HISTORY', returnTo: '/(tabs)/profile' };
  }

  if (route === 'inbox') {
    return { action: 'ORDER_HISTORY', returnTo: '/(tabs)/home' };
  }

  if (route === 'customer/orders/detail' || route === 'customer/appointments/detail') {
    const resourceId = typeof data.resourceId === 'string' ? data.resourceId.trim() : '';
    const base = route === 'customer/orders/detail' ? '/orders' : '/appointments';
    if (!resourceId || !isUuid(resourceId)) return null;
    return { action: 'ORDER_HISTORY', returnTo: `${base}/${resourceId}` };
  }

  return null;
}

type RequireAuth = (intent: AuthIntent) => Promise<boolean>;

export function usePushNotifications(
  userId?: string | null,
  accessToken?: string | null,
  requireAuth?: RequireAuth,
) {
  const router = useRouter();
  const handledResponseId = useRef<string | null>(null);
  const expoGoNoticeShown = useRef(false);
  const registeredForUser = useRef<string | null>(null);
  const registeredToken = useRef<string | null>(null);
  const registeredAccessToken = useRef<string | null>(null);
  const previousAuthentication = useRef<{ userId: string; accessToken: string } | null>(null);

  const handleNotificationResponse = useCallback(
    async (response: NotificationResponse) => {
      if (!requireAuth) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseId.current === responseId) return;

      const intent = notificationIntent(response.notification.request.content.data ?? {});
      if (!intent) return;

      handledResponseId.current = responseId;
      const alreadyAuthenticated = await requireAuth(intent);
      if (alreadyAuthenticated) {
        router.push({ pathname: intent.returnTo, params: intent.params } as never);
      }
    },
    [requireAuth, router],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;

    if (isExpoGo()) {
      if (!expoGoNoticeShown.current) {
        expoGoNoticeShown.current = true;
        console.info('Remote push notifications are disabled in Expo Go. Use a development build to test push notifications.');
      }
      return;
    }

    let disposed = false;
    let subscription: { remove: () => void } | undefined;
    const NotificationsMod = getNotificationsModule();
    if (!NotificationsMod) return;

    try {
      subscription = NotificationsMod.addNotificationResponseReceivedListener((response) => {
        void handleNotificationResponse(response);
      });
      void NotificationsMod.getLastNotificationResponseAsync().then((response) => {
        if (response && !disposed) void handleNotificationResponse(response);
      });
    } catch (error) {
      console.warn('Unable to initialize notification response handling', error);
    }

    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [handleNotificationResponse]);

  useEffect(() => {
    const previous = previousAuthentication.current;
    if (previous && !userId) {
      registeredToken.current = null;
      registeredForUser.current = null;
      registeredAccessToken.current = null;
    }

    previousAuthentication.current = userId && accessToken ? { userId, accessToken } : null;
  }, [accessToken, userId]);

  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      isExpoGo() ||
      !userId ||
      !accessToken ||
      appConfig.allowDemoMode
    ) {
      return;
    }
    if (
      registeredForUser.current === userId &&
      registeredToken.current &&
      registeredAccessToken.current === accessToken
    ) {
      return;
    }

    void registerDeviceRegistration(accessToken)
      .then((token) => {
        registeredForUser.current = userId;
        registeredToken.current = token ?? 'permission-denied';
        registeredAccessToken.current = accessToken;
      })
      .catch((error) => {
        registeredForUser.current = null;
        registeredToken.current = null;
        registeredAccessToken.current = null;
        console.warn('Unable to register device registration', error);
      });
  }, [accessToken, userId]);

  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      isExpoGo() ||
      !userId ||
      !accessToken ||
      appConfig.allowDemoMode
    ) {
      return;
    }

    let disposed = false;
    let tokenSubscription: { remove: () => void } | undefined;
    const NotificationsMod = getNotificationsModule();

    if (NotificationsMod && typeof NotificationsMod.addPushTokenListener === 'function') {
      tokenSubscription = NotificationsMod.addPushTokenListener((tokenObj) => {
        const newToken = typeof tokenObj?.data === 'string' ? tokenObj.data.trim() : '';
        if (newToken && newToken !== registeredToken.current && !disposed) {
          void registerDeviceRegistration(accessToken, newToken)
            .then((token) => {
              if (token) {
                registeredForUser.current = userId;
                registeredToken.current = token;
                registeredAccessToken.current = accessToken;
              }
            })
            .catch((error) => {
              console.warn('Unable to re-register rotated push token', error);
            });
        }
      });
    }

    return () => {
      disposed = true;
      tokenSubscription?.remove();
    };
  }, [accessToken, userId]);
}