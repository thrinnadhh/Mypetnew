import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';

import type { AuthIntent } from '@/auth/auth-intent';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { appConfig } from '@/utils/app-config';
import { getOrCreateInstallationId } from '@/utils/installation-id';

const isExpoGo = Constants.appOwnership === 'expo';

let handlerConfigured = false;

function getNotificationsModule() {
  if (Platform.OS === 'web' || isExpoGo) return null;

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

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Push registration failed (${response.status})`);
}

export async function revokeDeviceRegistration(
  installationId: string,
  accessToken: string,
): Promise<void> {
  if (Platform.OS === 'web' || isExpoGo) return;

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

async function registerDeviceRegistration(
  accessToken: string,
  overrideNativeToken?: string,
): Promise<string | null> {
  if (Platform.OS === 'web' || isExpoGo) return null;
  if (Platform.OS !== 'android') return null;

  const NotificationsMod = getNotificationsModule();
  if (!NotificationsMod) return null;

  if (!Device.isDevice) return null;

  const installationId = await getOrCreateInstallationId();

  // Android 13+: Channel MUST be configured BEFORE requesting notification permission
  await NotificationsMod.setNotificationChannelAsync('customer-reminders', {
    name: 'Pet care reminders',
    importance: NotificationsMod.AndroidImportance.HIGH,
    sound: 'default',
  });

  const permission = await NotificationsMod.requestPermissionsAsync();

  if (!permission.granted) {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/devices/registrations`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        appKind: 'CUSTOMER',
        environment: appConfig.environment,
        installationId,
        platform: 'ANDROID',
        nativeToken: '',
        permissionState: 'DENIED',
      }),
    });
    if (!response.ok) throw await responseError(response);
    return null;
  }

  let token = overrideNativeToken;
  if (!token) {
    const tokenResponse = await NotificationsMod.getDevicePushTokenAsync();
    token = typeof tokenResponse.data === 'string' ? tokenResponse.data.trim() : '';
  }

  if (!token || token.length > 4096) {
    return null;
  }

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/devices/registrations`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      appKind: 'CUSTOMER',
      environment: appConfig.environment,
      installationId,
      platform: 'ANDROID',
      nativeToken: token,
      permissionState: 'GRANTED',
    }),
  });

  if (!response.ok) throw await responseError(response);
  return token;
}

function isValidUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export function notificationIntent(data: Record<string, unknown>): AuthIntent | null {
  const route = typeof data.route === 'string' ? data.route.trim().toLowerCase() : '';
  const resourceId = isValidUuid(data.resourceId) ? (data.resourceId as string).trim() : undefined;

  if (route) {
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

    if (route === 'customer/loyalty' || route === 'loyalty') {
      return {
        action: 'ORDER_HISTORY',
        returnTo: '/(tabs)/profile',
      };
    }

    if (route === 'inbox') {
      return {
        action: 'ORDER_HISTORY',
        returnTo: '/(tabs)/home',
      };
    }

    if (route === 'customer/orders/detail' || route === 'customer/orders') {
      return {
        action: 'ORDER_HISTORY',
        returnTo: resourceId ? `/orders/${resourceId}` : '/(tabs)/orders',
      };
    }

    if (route === 'customer/appointments/detail' || route === 'customer/appointments') {
      return {
        action: 'ORDER_HISTORY',
        returnTo: '/appointments',
        params: resourceId ? { appointmentId: resourceId } : undefined,
      };
    }

    return null;
  }

  // Legacy fallback if data.route is absent
  const templateCode = typeof data.templateCode === 'string' ? data.templateCode.toUpperCase() : '';
  const referenceId = typeof data.referenceId === 'string' ? data.referenceId : undefined;

  if (templateCode.startsWith('APPOINTMENT_') || templateCode.startsWith('VACCINATION_')) {
    return {
      action: 'ORDER_HISTORY',
      returnTo: '/appointments',
      params: referenceId ? { appointmentId: referenceId } : undefined,
    };
  }

  if (templateCode.includes('RECURRING') || templateCode.includes('SUBSCRIPTION')) {
    return { action: 'ORDER_HISTORY', returnTo: '/subscriptions' };
  }

  if (templateCode.includes('MEDICAL_DOCUMENT')) {
    return {
      action: 'MEDICAL_WRITE',
      returnTo: '/health/reports',
      params: referenceId ? { appointmentId: referenceId } : undefined,
    };
  }

  if (
    templateCode.includes('ORDER') ||
    templateCode.includes('DELIVERY') ||
    templateCode.includes('PAYMENT') ||
    templateCode.includes('CASE') ||
    templateCode.includes('REFUND')
  ) {
    return {
      action: 'ORDER_HISTORY',
      returnTo: referenceId ? `/orders/${referenceId}` : '/(tabs)/orders',
    };
  }

  return null;
}

export function usePushNotifications(
  userId?: string | null,
  accessToken?: string | null,
) {
  const router = useRouter();
  const { requireAuth } = useAuthIntent();
  const handledResponseId = useRef<string | null>(null);
  const expoGoNoticeShown = useRef(false);
  const registeredForUser = useRef<string | null>(null);
  const registeredToken = useRef<string | null>(null);
  const registeredAccessToken = useRef<string | null>(null);
  const previousAuthentication = useRef<{
    userId: string;
    accessToken: string;
  } | null>(null);

  const handleNotificationResponse = useCallback(
    async (response: NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (handledResponseId.current === responseId) return;

      const intent = notificationIntent(
        response.notification.request.content.data ?? {},
      );
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

    if (isExpoGo) {
      if (!expoGoNoticeShown.current) {
        expoGoNoticeShown.current = true;
        console.info(
          'Remote push notifications are disabled in Expo Go. Use a development build to test push notifications.',
        );
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

    previousAuthentication.current =
      userId && accessToken ? { userId, accessToken } : null;
  }, [accessToken, userId]);

  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      isExpoGo ||
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
      isExpoGo ||
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
