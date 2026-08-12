import { Platform } from 'react-native';

const isTruthy = (value: string | undefined) => value === 'true' || value === '1';

const defaultGatewayUrl = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://localhost:8080',
  default: 'http://localhost:8080',
}) ?? 'http://localhost:8080';

const allowDemoMode = __DEV__ && isTruthy(process.env.EXPO_PUBLIC_ALLOW_DEMO_MODE);
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');

export const appConfig = {
  apiBaseUrl: configuredApiBaseUrl || (__DEV__ ? defaultGatewayUrl : ''),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  allowDemoMode,
};

export function requireMobileConfig() {
  const missing = [
    appConfig.apiBaseUrl ? null : 'EXPO_PUBLIC_API_BASE_URL',
    appConfig.supabaseUrl ? null : 'EXPO_PUBLIC_SUPABASE_URL',
    appConfig.supabaseAnonKey ? null : 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);

  if (missing.length > 0 && !appConfig.allowDemoMode) {
    throw new Error(
      `Missing mobile configuration: ${missing.join(', ')}. ` +
      'Set EXPO_PUBLIC_ALLOW_DEMO_MODE=true only in a development build with local demo fixtures.'
    );
  }
  if (!__DEV__ && !appConfig.apiBaseUrl.startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS in production builds.');
  }
}
