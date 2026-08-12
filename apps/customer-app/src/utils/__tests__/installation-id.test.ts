import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearCachedInstallationIdForTesting,
  getOrCreateInstallationId,
} from '@/utils/installation-id';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-v4-1234'),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const mockGetItem = SecureStore.getItemAsync as jest.MockedFunction<typeof SecureStore.getItemAsync>;
const mockSetItem = SecureStore.setItemAsync as jest.MockedFunction<typeof SecureStore.setItemAsync>;
const mockRandomUUID = Crypto.randomUUID as jest.MockedFunction<typeof Crypto.randomUUID>;

describe('Installation / Device ID generator', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    clearCachedInstallationIdForTesting();
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('generates a stable UUIDv4 once and persists it in SecureStore on native', async () => {
    Platform.OS = 'ios';
    mockGetItem.mockResolvedValueOnce(null);

    const id1 = await getOrCreateInstallationId();
    expect(id1).toBe('mock-uuid-v4-1234');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      'mypetnew_installation_id',
      'mock-uuid-v4-1234',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    );

    // Second call reuses memory cache
    const id2 = await getOrCreateInstallationId();
    expect(id2).toBe('mock-uuid-v4-1234');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
  });

  it('returns existing stored installation ID from SecureStore', async () => {
    Platform.OS = 'android';
    mockGetItem.mockResolvedValueOnce('existing-installation-uuid');

    const id = await getOrCreateInstallationId();
    expect(id).toBe('existing-installation-uuid');
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });
});
