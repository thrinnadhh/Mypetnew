import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_STATE_KEY = 'mypetnew.merchant.refresh.v1';

type StoredRefreshState = {
  version: 1;
  accountId: string;
  refreshTokenExpiresAt: string;
};

export async function currentOfflineMerchantAccountId(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(REFRESH_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRefreshState>;
    const expiry = typeof parsed.refreshTokenExpiresAt === 'string'
      ? Date.parse(parsed.refreshTokenExpiresAt)
      : Number.NaN;
    if (
      parsed.version !== 1 ||
      typeof parsed.accountId !== 'string' ||
      !parsed.accountId.trim() ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    ) {
      return null;
    }
    return parsed.accountId.trim();
  } catch {
    return null;
  }
}
