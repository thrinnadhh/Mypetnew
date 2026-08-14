import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { NotificationResponse } from 'expo-notifications';

import type { AuthIntent } from '@/auth/auth-intent';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { appConfig } from '@/utils/app-config';
import { getOrCreateInstallationId } from '@/utils/installation-id';

const isExpoGo = Constants.appOwnership === 'expo';

let notificationsModulePromise:
  | Promise<typeof import('expo-notifications') | null>
  | null = null;

async function getNotificationsModule() {
  if (Platform.OS === 'web' || isExpoGo) return null;

  if (!notificationsModulePromise) {
    notificationsModulePromise = import('expo-notifications')
      .then((Notifications) => {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
        return Notifications;
      })
      .catch((error) => {
        notificationsModulePromise = null;
        console.warn('Unable to initialize push notifications', error);
        return null;
      });
  }

  return notificationsModulePromise;
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

  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;

  const Device = await import('expo-device');
  if (!Device.isDevice) return null;

  const installationId = await getOrCreateInstallationId();
  const permission = await Notifications.requestPermissionsAsync();

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

  await Notifications.setNotificationChannelAsync('customer-reminders', {
    name: 'Pet care reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });

  let token = overrideNativeToken;
  if (!token) {
    const tokenResponse = await Notifications.getDevicePushTokenAsync();
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

function notificationIntent(data: Record<string, unknown>): AuthIntent | null {
  const templateCode =
    typeof data.templateCode === 'string' ? data.templateCode.toUpperCase() : '';
  const referenceId =
    typeof data.referenceId === 'string' ? data.referenceId : undefined;

  if (
    templateCode.startsWith('APPOINTMENT_') ||
    templateCode.startsWith('VACCINATION_')
  ) {
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

    void getNotificationsModule()
      .then(async (Notifications) => {
        if (!Notifications || disposed) return;
        subscription = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            void handleNotificationResponse(response);
          },
        );
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response && !disposed) await handleNotificationResponse(response);
      })
      .catch((error) =>
        console.warn('Unable to initialize notification response handling', error),
      );

    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [handleNotificationResponse]);

  useEffect(() => {
    const previous = previousAuthentication.current;
    if (previous && !userId && registeredToken.current) {
      registeredToken.current = null;
      registeredForUser.current = null;
      void getOrCreateInstallationId()
        .then((installationId) => revokeDeviceRegistration(installationId, previous.accessToken))
        .catch((error) => {
          console.warn('Unable to revoke push registration on session end', error);
        });
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
    if (registeredForUser.current === userId && registeredToken.current) return;

    void registerDeviceRegistration(accessToken)
      .then((token) => {
        if (token) {
          registeredForUser.current = userId;
          registeredToken.current = token;
        }
      })
      .catch((error) => {
        registeredForUser.current = null;
        registeredToken.current = null;
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

    void getNotificationsModule().then((Notifications) => {
      if (!Notifications || disposed) return;
      if (typeof Notifications.addPushTokenListener === 'function') {
        tokenSubscription = Notifications.addPushTokenListener((tokenObj) => {
          const newToken = typeof tokenObj?.data === 'string' ? tokenObj.data.trim() : '';
          if (newToken && newToken !== registeredToken.current && !disposed) {
            void registerDeviceRegistration(accessToken, newToken)
              .then((token) => {
                if (token) {
                  registeredForUser.current = userId;
                  registeredToken.current = token;
                }
              })
              .catch((error) => {
                console.warn('Unable to re-register rotated push token', error);
              });
          }
        });
      }
    });

    return () => {
      disposed = true;
      tokenSubscription?.remove();
    };
  }, [accessToken, userId]);
}
