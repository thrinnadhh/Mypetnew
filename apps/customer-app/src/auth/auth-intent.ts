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

export interface AuthIntent {
  action: ProtectedAction;
  returnTo: string;
  params?: Record<string, string>;
}

export function serializeAuthIntent(intent: AuthIntent): string {
  return encodeURIComponent(JSON.stringify(intent));
}

export function parseAuthIntent(value?: string | string[] | null): AuthIntent | null {
  if (!value || Array.isArray(value)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<AuthIntent>;
    if (!parsed.action || !PROTECTED_ACTIONS.includes(parsed.action as ProtectedAction) || typeof parsed.returnTo !== 'string' || !parsed.returnTo.startsWith('/')) return null;
    return { action: parsed.action as ProtectedAction, returnTo: parsed.returnTo, params: parsed.params };
  } catch {
    return null;
  }
}
