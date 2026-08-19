export const PROTECTED_ACTIONS = [
  'FAVOURITE',
  'BOOKING',
  'CHECKOUT',
  'MEDICAL_WRITE',
  'LOYALTY_CLAIM',
  'REWARD_REDEEM',
  'SENSITIVE_ACCOUNT_CHANGE',
  'ORDER_HISTORY',
] as const;

export type ProtectedAction = (typeof PROTECTED_ACTIONS)[number];

export const AUTH_INTENT_DESTINATIONS = [
  '/(tabs)/home',
  '/(tabs)/orders',
  '/(tabs)/profile',
  '/appointments',
  '/checkout',
  '/groom',
  '/health/reports',
  '/support',
  '/subscriptions',
  '/vet',
  '/wallet',
] as const;

type AuthIntentDestination = (typeof AUTH_INTENT_DESTINATIONS)[number];

export interface AuthIntent {
  action: ProtectedAction;
  returnTo: string;
  params?: Record<string, string>;
}

function normalizeParams(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 16) return null;
  const params: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || typeof item !== 'string' || item.length > 2048) return null;
    params[key] = item;
  }
  return params;
}

export function isSafeAuthDestination(value: unknown): value is AuthIntentDestination {
  return typeof value === 'string'
    && (AUTH_INTENT_DESTINATIONS as readonly string[]).includes(value);
}

export function normalizeAuthIntent(value: unknown): AuthIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = value as Partial<AuthIntent>;
  if (!parsed.action || !PROTECTED_ACTIONS.includes(parsed.action as ProtectedAction)) return null;
  if (!isSafeAuthDestination(parsed.returnTo)) return null;
  const params = normalizeParams(parsed.params);
  if (params === null) return null;
  return {
    action: parsed.action as ProtectedAction,
    returnTo: parsed.returnTo,
    ...(params ? { params } : {}),
  };
}

export function serializeAuthIntent(intent: AuthIntent): string {
  const normalized = normalizeAuthIntent(intent);
  if (!normalized) throw new Error('Unsafe authentication continuation intent');
  return encodeURIComponent(JSON.stringify(normalized));
}

export function parseAuthIntent(value?: string | string[] | null): AuthIntent | null {
  if (!value || Array.isArray(value)) return null;
  try {
    return normalizeAuthIntent(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
}
