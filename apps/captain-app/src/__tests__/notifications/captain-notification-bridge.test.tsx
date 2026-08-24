import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { clearSession, storeSession } from '../../auth/session';
import { CaptainNotificationBridge } from '../../notifications/captain-notifications';
import { useDeliveryStore } from '../../state/delivery-store';
import { connectivity } from '../../sync/connectivity';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('../../state/delivery-store', () => ({
  useDeliveryStore: jest.fn(),
}));

const OFFER_ID = '550e8400-e29b-41d4-a716-446655440000';

function signalNotification() {
  return {
    request: {
      content: {
        data: { route: 'captain/dispatch/offer', resourceId: OFFER_ID },
      },
    },
  } as any;
}

async function flushEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('Captain notification signal bridge', () => {
  let foregroundListener: ((notification: any) => void) | undefined;
  let responseListener: ((response: any) => void) | undefined;
  let revalidateOffer: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    connectivity.setConnected(true);
    await clearSession();
    await storeSession({
      accountId: 'captain-notification-bridge',
      accessToken: 'captain-access',
      refreshToken: 'captain-refresh',
      accessTokenExpiresAt: '2026-08-24T12:00:00Z',
      refreshTokenExpiresAt: '2026-09-24T12:00:00Z',
      role: 'CAPTAIN',
    });
    (global as any).fetch = jest.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    revalidateOffer = jest.fn();
    (useDeliveryStore as jest.Mock).mockReturnValue({ revalidateOffer });
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
    (Notifications.addNotificationReceivedListener as jest.Mock).mockImplementation((listener) => {
      foregroundListener = listener;
      return { remove: jest.fn() };
    });
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation((listener) => {
      responseListener = listener;
      return { remove: jest.fn() };
    });
  });

  it('revalidates foreground and tap signals while navigating an offer at most once', async () => {
    revalidateOffer.mockResolvedValue(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<CaptainNotificationBridge />);
      await flushEffects();
    });

    await act(async () => {
      foregroundListener?.(signalNotification());
      await flushEffects();
    });
    expect(router.push).not.toHaveBeenCalled();

    await act(async () => {
      responseListener?.({ notification: signalNotification() });
      await flushEffects();
      responseListener?.({ notification: signalNotification() });
      await flushEffects();
    });

    expect(revalidateOffer).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('retains a cold-start signal after failed revalidation and retries on reconnect', async () => {
    connectivity.setConnected(false);
    revalidateOffer.mockResolvedValueOnce(null).mockResolvedValueOnce(true);
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({
      notification: signalNotification(),
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<CaptainNotificationBridge />);
      await flushEffects();
    });
    expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();

    await act(async () => {
      connectivity.setConnected(true);
      await flushEffects();
    });

    expect(revalidateOffer).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith('/delivery/offer');
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});
