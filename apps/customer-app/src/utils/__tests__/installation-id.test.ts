import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearCachedInstallationIdForTesting,
  getOrCreateInstallationId,
} from '@/utils/installation-id';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
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
    expect(id1).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      'mypetnew_installation_id',
      '123e4567-e89b-42d3-a456-426614174000',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );

    const id2 = await getOrCreateInstallationId();
    expect(id2).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
  });

  it('returns an existing valid UUIDv4 installation ID from SecureStore', async () => {
    Platform.OS = 'android';
    mockGetItem.mockResolvedValueOnce('9b2f6b42-6f4a-4b1c-8c4a-8dc2f6149901');

    const id = await getOrCreateInstallationId();
    expect(id).toBe('9b2f6b42-6f4a-4b1c-8c4a-8dc2f6149901');
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it('replaces malformed persisted installation state instead of trusting it', async () => {
    Platform.OS = 'android';
    mockGetItem.mockResolvedValueOnce('not-a-valid-installation-id');

    await expect(getOrCreateInstallationId()).resolves.toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(mockSetItem).toHaveBeenCalledWith(
      'mypetnew_installation_id',
      '123e4567-e89b-42d3-a456-426614174000',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
  });

  it('fails closed when native secure installation storage is unavailable', async () => {
    Platform.OS = 'android';
    mockGetItem.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    await expect(getOrCreateInstallationId()).rejects.toThrow('SecureStore unavailable');
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });
});
