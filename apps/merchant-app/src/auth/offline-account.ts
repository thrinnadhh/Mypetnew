import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_STATE_KEY = 'mypetnew.merchant.refresh.v1';

type StoredRefreshState = {
  version: 1;
  accountId: string;
  refreshTokenExpiresAt: string;
};

export async function loadOfflineMerchantAccountId(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(REFRESH_STATE_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<StoredRefreshState>;
    if (state.version !== 1 || typeof state.accountId !== 'string' || !state.accountId.trim()) return null;
    if (typeof state.refreshTokenExpiresAt !== 'string') return null;
    const expiry = Date.parse(state.refreshTokenExpiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
    return state.accountId.trim();
  } catch {
    return null;
  }
}
