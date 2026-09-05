import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { registerCaptainDevice } from '../api/devices';
import { getAuthGeneration, getRuntimeAccountId } from '../auth/session';
import { useDeliveryStore } from '../state/delivery-store';
import { connectivity } from '../sync/connectivity';
import { isUuid } from '../utils/uuid';

export type CaptainNotificationPermissionState =
  | 'GRANTED'
  | 'DENIED'
  | 'UNDETERMINED'
  | 'UNAVAILABLE';

export type CaptainPushSignal = {
  notificationId?: string;
  offerId: string;
};

const VALIDATION_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function parseCaptainPushSignal(data: unknown): CaptainPushSignal | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (payload.route !== 'captain/dispatch/offer' || !isUuid(payload.resourceId)) return null;
  if (
    payload.notificationId !== undefined &&
    !isUuid(payload.notificationId)
  ) {
    return null;
  }
  return {
    offerId: payload.resourceId,
    notificationId: payload.notificationId as string | undefined,
  };
}

function permissionState(
  status: Notifications.NotificationPermissionsStatus,
): CaptainNotificationPermissionState {
  if (status.granted || status.status === 'granted') return 'GRANTED';
  if (status.status === 'denied') return 'DENIED';
  return 'UNDETERMINED';
}

async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('captain-assignments', {
    name: 'Delivery assignments',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: '#1A56DB',
    sound: 'default',
  });
}

export async function getCaptainNotificationPermission(): Promise<CaptainNotificationPermissionState> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'UNAVAILABLE';
  try {
    return permissionState(await Notifications.getPermissionsAsync());
  } catch {
    return 'UNAVAILABLE';
  }
}

export async function registerCaptainNotifications(
  requestPermission = false,
): Promise<CaptainNotificationPermissionState> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'UNAVAILABLE';
  await configureAndroidChannel();

  const permissions = requestPermission
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  const state = permissionState(permissions);

  if (state === 'DENIED') {
    await registerCaptainDevice('', 'DENIED');
    return state;
  }
  if (state !== 'GRANTED') return state;

  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== 'string' || !token.data.trim()) return 'UNAVAILABLE';
  await registerCaptainDevice(token.data, 'GRANTED');
  return state;
}

export function CaptainNotificationBridge(): React.ReactElement | null {
  const { revalidateOffer } = useDeliveryStore();

  useEffect(() => {
    const accountId = getRuntimeAccountId();
    const generation = getAuthGeneration();
    if (!accountId) return;

    let active = true;
    let pendingColdData: unknown = null;
    let coldRetryInFlight = false;
    let coldRetryAttempt = 0;
    let coldRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTapData: unknown = null;
    let tapRetryInFlight = false;
    let tapRetryAttempt = 0;
    let tapRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const validationFlights = new Map<string, Promise<boolean | null>>();
    const navigatedOffers = new Set<string>();
    const sessionIsCurrent = () =>
      active &&
      getRuntimeAccountId() === accountId &&
      getAuthGeneration() === generation;

    const clearColdRetryTimer = () => {
      if (coldRetryTimer) {
        clearTimeout(coldRetryTimer);
        coldRetryTimer = null;
      }
    };

    const clearTapRetryTimer = () => {
      if (tapRetryTimer) {
        clearTimeout(tapRetryTimer);
        tapRetryTimer = null;
      }
    };

    const handleSignal = async (
      data: unknown,
      navigate: boolean,
    ): Promise<'HANDLED' | 'RETRY' | 'DISCARDED'> => {
      const signal = parseCaptainPushSignal(data);
      if (!signal) return 'DISCARDED';
      if (!sessionIsCurrent()) return 'RETRY';
      if (navigate && navigatedOffers.has(signal.offerId)) return 'HANDLED';

      let validation = validationFlights.get(signal.offerId);
      if (!validation) {
        validation = revalidateOffer(signal.offerId);
        validationFlights.set(signal.offerId, validation);
        validation.then(() => {
          if (validationFlights.get(signal.offerId) === validation) {
            validationFlights.delete(signal.offerId);
          }
        }, () => {
          if (validationFlights.get(signal.offerId) === validation) {
            validationFlights.delete(signal.offerId);
          }
        });
      }
      const authoritativeOfferExists = await validation;
      if (!sessionIsCurrent() || authoritativeOfferExists === null) return 'RETRY';
      if (navigate && authoritativeOfferExists) {
        navigatedOffers.add(signal.offerId);
        router.push('/delivery/offer');
      }
      return 'HANDLED';
    };

    const scheduleColdRetry = () => {
      if (
        !pendingColdData ||
        !sessionIsCurrent() ||
        !connectivity.online ||
        coldRetryTimer ||
        coldRetryAttempt >= VALIDATION_RETRY_DELAYS_MS.length
      ) {
        return;
      }
      const delay = VALIDATION_RETRY_DELAYS_MS[coldRetryAttempt++];
      coldRetryTimer = setTimeout(() => {
        coldRetryTimer = null;
        if (pendingColdData) {
          processColdResponse(pendingColdData).catch(() => {});
        }
      }, delay);
    };

    const scheduleTapRetry = () => {
      if (
        !pendingTapData ||
        !sessionIsCurrent() ||
        !connectivity.online ||
        tapRetryTimer ||
        tapRetryAttempt >= VALIDATION_RETRY_DELAYS_MS.length
      ) {
        return;
      }
      const delay = VALIDATION_RETRY_DELAYS_MS[tapRetryAttempt++];
      tapRetryTimer = setTimeout(() => {
        tapRetryTimer = null;
        if (pendingTapData) {
          processTapResponse(pendingTapData).catch(() => {});
        }
      }, delay);
    };

    const processColdResponse = async (data: unknown) => {
      if (coldRetryInFlight || !sessionIsCurrent()) return;
      coldRetryInFlight = true;
      let shouldRetry = false;
      try {
        const outcome = await handleSignal(data, true);
        if (outcome === 'RETRY') {
          pendingColdData = data;
          shouldRetry = true;
        } else {
          pendingColdData = null;
          coldRetryAttempt = 0;
          clearColdRetryTimer();
          await Notifications.clearLastNotificationResponseAsync();
        }
      } finally {
        coldRetryInFlight = false;
      }
      if (shouldRetry) scheduleColdRetry();
    };

    const processTapResponse = async (data: unknown) => {
      if (tapRetryInFlight || !sessionIsCurrent()) return;
      tapRetryInFlight = true;
      let shouldRetry = false;
      try {
        const outcome = await handleSignal(data, true);
        if (outcome === 'RETRY') {
          pendingTapData = data;
          shouldRetry = true;
        } else {
          pendingTapData = null;
          tapRetryAttempt = 0;
          clearTapRetryTimer();
        }
      } finally {
        tapRetryInFlight = false;
      }
      if (shouldRetry) scheduleTapRetry();
    };

    registerCaptainNotifications(false).catch(() => {});
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (!sessionIsCurrent() || typeof token.data !== 'string') return;
      registerCaptainDevice(token.data, 'GRANTED').catch(() => {});
    });
    const foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
      handleSignal(notification.request.content.data, false).catch(() => {});
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      processTapResponse(response.notification.request.content.data).catch(() => {});
    });

    const unsubscribeConnectivity = connectivity.subscribe((online) => {
      if (!online) return;
      if (pendingColdData) {
        coldRetryAttempt = 0;
        clearColdRetryTimer();
        processColdResponse(pendingColdData).catch(() => {});
      }
      if (pendingTapData) {
        tapRetryAttempt = 0;
        clearTapRetryTimer();
        processTapResponse(pendingTapData).catch(() => {});
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !sessionIsCurrent()) return;
      if (pendingColdData) {
        coldRetryAttempt = 0;
        clearColdRetryTimer();
        processColdResponse(pendingColdData).catch(() => {});
      }
      if (pendingTapData) {
        tapRetryAttempt = 0;
        clearTapRetryTimer();
        processTapResponse(pendingTapData).catch(() => {});
      }
    });

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) return processColdResponse(response.notification.request.content.data);
      })
      .catch(() => {});

    return () => {
      active = false;
      clearColdRetryTimer();
      clearTapRetryTimer();
      tokenSubscription.remove();
      foregroundSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
      unsubscribeConnectivity();
    };
  }, [revalidateOffer]);

  return null;
}