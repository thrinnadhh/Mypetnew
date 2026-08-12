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
const SESSION_KEY = 'mypetnew_customer_session_v1';

function validState(overrides: Partial<PersistedRefreshState> = {}): PersistedRefreshState {
  return {
    refreshToken: 'refresh-jwt-123',
    refreshTokenExpiresAt: '2099-01-01T00:00:00Z',
    accountId: 'account-uuid-1',
    mobile: '+919876543210',
    role: 'CUSTOMER',
    deviceId: '123e4567-e89b-42d3-a456-426614174000',
    ...overrides,
  };
}

function encoded(state: PersistedRefreshState): string {
  return JSON.stringify({ version: 1, state });
}

describe('MyPetNew secure session storage', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatform;
    jest.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('persists the full native refresh state as one SecureStore record', async () => {
    Platform.OS = 'ios';
    const state = validState();

    await savePersistedSession(state);

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      SESSION_KEY,
      encoded(state),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );

    mockGetItem.mockResolvedValueOnce(encoded(state));
    await expect(loadPersistedSession()).resolves.toEqual(state);
  });

  it('clears expired or malformed persisted refresh state', async () => {
    Platform.OS = 'android';

    mockGetItem.mockResolvedValueOnce(encoded(validState({ refreshTokenExpiresAt: '2020-01-01T00:00:00Z' })));
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);

    jest.clearAllMocks();
    mockGetItem.mockResolvedValueOnce('{not-json');
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it('clears state with malformed timestamps, wrong role, blank fields, or invalid mobile', async () => {
    Platform.OS = 'android';

    const invalidStates: PersistedRefreshState[] = [
      validState({ refreshTokenExpiresAt: 'not-a-date' }),
      { ...validState(), role: 'MERCHANT' as 'CUSTOMER' },
      validState({ refreshToken: '   ' }),
      validState({ mobile: '+915876543210' }),
      validState({ deviceId: '   ' }),
    ];

    for (const state of invalidStates) {
      jest.clearAllMocks();
      mockGetItem.mockResolvedValueOnce(encoded(state));
      await expect(loadPersistedSession()).resolves.toBeNull();
      expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
    }
  });

  it('rejects invalid state before any native write occurs', async () => {
    Platform.OS = 'ios';

    await expect(savePersistedSession(validState({ mobile: '+14155552671' }))).rejects.toThrow(
      'Persisted Customer session state is invalid',
    );
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('propagates the single SecureStore write failure without publishing a partial record', async () => {
    Platform.OS = 'android';
    mockSetItem.mockRejectedValueOnce(new Error('SecureStore write failed'));

    await expect(savePersistedSession(validState())).rejects.toThrow('SecureStore write failed');
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('uses one browser sessionStorage record on web and never localStorage', async () => {
    Platform.OS = 'web';

    const values = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    };

    const state = validState({ refreshToken: 'web-refresh-jwt', accountId: 'account-uuid-web' });
    await savePersistedSession(state);

    expect(values.size).toBe(1);
    expect(values.get(SESSION_KEY)).toBe(encoded(state));
    expect(mockSetItem).not.toHaveBeenCalled();
    await expect(loadPersistedSession()).resolves.toEqual(state);

    await clearPersistedSession();
    expect(values.has(SESSION_KEY)).toBe(false);
    await expect(loadPersistedSession()).resolves.toBeNull();
  });
});
