import * as Notifications from 'expo-notifications';
import {
  clearSession,
  getInstallationDeviceId,
  storeSession,
} from '../../auth/session';
import { revokeCaptainDevice } from '../../api/devices';
import {
  parseCaptainPushSignal,
  registerCaptainNotifications,
} from '../../notifications/captain-notifications';

describe('Captain notification registration and signal validation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearSession();
    (global as any).fetch = jest.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('accepts only the allowlisted assignment route with UUID identifiers', () => {
    expect(parseCaptainPushSignal({
      route: 'captain/dispatch/offer',
      resourceId: '550e8400-e29b-41d4-a716-446655440000',
      notificationId: '550e8400-e29b-41d4-a716-446655440001',
    })).toEqual({
      offerId: '550e8400-e29b-41d4-a716-446655440000',
      notificationId: '550e8400-e29b-41d4-a716-446655440001',
    });

    expect(parseCaptainPushSignal({
      route: 'delivery/another-captain',
      resourceId: '550e8400-e29b-41d4-a716-446655440000',
    })).toBeNull();
    expect(parseCaptainPushSignal({
      route: 'captain/dispatch/offer',
      resourceId: '../active',
    })).toBeNull();
    expect(parseCaptainPushSignal(null)).toBeNull();
  });

  it('binds the native push token to the authenticated Captain installation', async () => {
    await storeSession({
      accountId: 'captain-notification-test',
      accessToken: 'captain-access',
      refreshToken: 'captain-refresh',
      accessTokenExpiresAt: '2026-08-24T12:00:00Z',
      refreshTokenExpiresAt: '2026-09-24T12:00:00Z',
      role: 'CAPTAIN',
    });
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      granted: true,
    });
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValue({
      type: 'ios',
      data: 'native-token-a',
    });

    await expect(registerCaptainNotifications(false)).resolves.toBe('GRANTED');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/devices/registrations');
    expect(JSON.parse(init.body)).toMatchObject({
      appKind: 'CAPTAIN',
      nativeToken: 'native-token-a',
      permissionState: 'GRANTED',
    });
    expect(JSON.parse(init.body).installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('records denied permission without sending a fabricated native token', async () => {
    await storeSession({
      accountId: 'captain-notification-test',
      accessToken: 'captain-access',
      refreshToken: 'captain-refresh',
      accessTokenExpiresAt: '2026-08-24T12:00:00Z',
      refreshTokenExpiresAt: '2026-09-24T12:00:00Z',
      role: 'CAPTAIN',
    });
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      granted: false,
    });

    await expect(registerCaptainNotifications(false)).resolves.toBe('DENIED');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({ nativeToken: '', permissionState: 'DENIED' });
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it('dispatches authenticated device revocation before local logout invalidates credentials', async () => {
    await getInstallationDeviceId();
    await storeSession({
      accountId: 'captain-notification-test',
      accessToken: 'captain-access',
      refreshToken: 'captain-refresh',
      accessTokenExpiresAt: '2026-08-24T12:00:00Z',
      refreshTokenExpiresAt: '2026-09-24T12:00:00Z',
      role: 'CAPTAIN',
    });

    let completeRequest!: (response: Response) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        completeRequest = resolve;
      }),
    );

    const revocation = revokeCaptainDevice().catch(() => {});
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/devices/registrations/');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer captain-access');

    await clearSession();
    completeRequest(new Response(null, { status: 204 }));
    await revocation;
  });
});
