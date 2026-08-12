import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearPersistedSession,
  loadPersistedSession,
  savePersistedSession,
} from '@/auth/session-storage';
import type { PersistedRefreshState } from '@/auth/types';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItem = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockSetItem = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;

describe('MyPetNew secure session storage', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatform;
    jest.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('persists and loads refresh session state using SecureStore on native platforms', async () => {
    Platform.OS = 'ios';

    const sessionState: PersistedRefreshState = {
      refreshToken: 'refresh-jwt-123',
      refreshTokenExpiresAt: '2099-01-01T00:00:00Z',
      accountId: 'account-uuid-1',
      mobile: '+919876543210',
      role: 'CUSTOMER',
      deviceId: 'device-uuid-1',
    };

    await savePersistedSession(sessionState);

    expect(mockSetItem).toHaveBeenCalledWith(
      'mypetnew_customer_refresh_token',
      'refresh-jwt-123',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      'mypetnew_customer_account_id',
      'account-uuid-1',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    );

    mockGetItem.mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        mypetnew_customer_refresh_token: 'refresh-jwt-123',
        mypetnew_customer_refresh_expires_at: '2099-01-01T00:00:00Z',
        mypetnew_customer_account_id: 'account-uuid-1',
        mypetnew_customer_mobile: '+919876543210',
        mypetnew_customer_role: 'CUSTOMER',
        mypetnew_customer_device_id: 'device-uuid-1',
      };
      return map[key] ?? null;
    });

    const loaded = await loadPersistedSession();
    expect(loaded).toEqual(sessionState);
  });

  it('automatically clears expired refresh sessions on native platforms', async () => {
    Platform.OS = 'android';

    mockGetItem.mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        mypetnew_customer_refresh_token: 'old-token',
        mypetnew_customer_refresh_expires_at: '2020-01-01T00:00:00Z', // Expired
        mypetnew_customer_account_id: 'account-uuid-1',
        mypetnew_customer_mobile: '+919876543210',
        mypetnew_customer_role: 'CUSTOMER',
        mypetnew_customer_device_id: 'device-uuid-1',
      };
      return map[key] ?? null;
    });

    const loaded = await loadPersistedSession();
    expect(loaded).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith('mypetnew_customer_refresh_token');
  });

  it('automatically clears persisted session when timestamp is malformed (NaN)', async () => {
    Platform.OS = 'android';

    mockGetItem.mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        mypetnew_customer_refresh_token: 'some-token',
        mypetnew_customer_refresh_expires_at: 'invalid-date-string', // NaN
        mypetnew_customer_account_id: 'account-uuid-1',
        mypetnew_customer_mobile: '+919876543210',
        mypetnew_customer_role: 'CUSTOMER',
        mypetnew_customer_device_id: 'device-uuid-1',
      };
      return map[key] ?? null;
    });

    const loaded = await loadPersistedSession();
    expect(loaded).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith('mypetnew_customer_refresh_token');
  });

  it('automatically clears persisted session when required fields are blank or role is non-CUSTOMER', async () => {
    Platform.OS = 'android';

    mockGetItem.mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        mypetnew_customer_refresh_token: 'token-1',
        mypetnew_customer_refresh_expires_at: '2099-01-01T00:00:00Z',
        mypetnew_customer_account_id: 'account-1',
        mypetnew_customer_mobile: '  ', // blank mobile
        mypetnew_customer_role: 'MERCHANT', // non-customer role
        mypetnew_customer_device_id: 'device-1',
      };
      return map[key] ?? null;
    });

    const loaded = await loadPersistedSession();
    expect(loaded).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith('mypetnew_customer_refresh_token');
  });

  it('uses browser sessionStorage on web and avoids localStorage', async () => {
    Platform.OS = 'web';

    const values = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    };

    const sessionState: PersistedRefreshState = {
      refreshToken: 'web-refresh-jwt',
      refreshTokenExpiresAt: '2099-01-01T00:00:00Z',
      accountId: 'account-uuid-web',
      mobile: '+919876543210',
      role: 'CUSTOMER',
      deviceId: 'device-web-1',
    };

    await savePersistedSession(sessionState);
    expect(values.get('mypetnew_customer_refresh_token')).toBe('web-refresh-jwt');
    expect(mockSetItem).not.toHaveBeenCalled();

    const loaded = await loadPersistedSession();
    expect(loaded).toEqual(sessionState);

    await clearPersistedSession();
    expect(await loadPersistedSession()).toBeNull();
  });
});
