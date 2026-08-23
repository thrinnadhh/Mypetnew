import * as Crypto from 'expo-crypto';

/**
 * Idempotency Key Manager for critical state-changing Captain commands
 * (such as marking an order picked up or delivered).
 */

const keyCache = new Map<string, string>();

export function getOrCreateIdempotencyKey(commandKey: string): string {
  const existing = keyCache.get(commandKey);
  if (existing) {
    return existing;
  }

  let newKey: string | undefined;
  try {
    newKey = Crypto.randomUUID();
  } catch {
    // fallback
  }

  const result = newKey || `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  keyCache.set(commandKey, result);
  return result;
}

export function clearIdempotencyKey(commandKey: string): void {
  keyCache.delete(commandKey);
}

export function resetAllIdempotencyKeys(): void {
  keyCache.clear();
}
