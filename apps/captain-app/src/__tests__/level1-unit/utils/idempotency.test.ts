import {
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  resetAllIdempotencyKeys,
} from '../../../utils/idempotency';

describe('Level 1: Idempotency Key Utility Tests', () => {
  beforeEach(() => {
    resetAllIdempotencyKeys();
  });

  it('generates a stable key across multiple invocations for the same command key', () => {
    const key1 = getOrCreateIdempotencyKey('dispatch:pickup:job-101');
    const key2 = getOrCreateIdempotencyKey('dispatch:pickup:job-101');
    expect(key1).toBe(key2);
    expect(typeof key1).toBe('string');
    expect(key1.length).toBeGreaterThan(10);
  });

  it('generates distinct keys for distinct command targets', () => {
    const pickupKey = getOrCreateIdempotencyKey('dispatch:pickup:job-101');
    const deliveryKey = getOrCreateIdempotencyKey('dispatch:delivered:job-101');
    const anotherJobPickupKey = getOrCreateIdempotencyKey('dispatch:pickup:job-202');

    expect(pickupKey).not.toBe(deliveryKey);
    expect(pickupKey).not.toBe(anotherJobPickupKey);
  });

  it('clears key on demand so subsequent executions generate a fresh key', () => {
    const key1 = getOrCreateIdempotencyKey('dispatch:pickup:job-101');
    clearIdempotencyKey('dispatch:pickup:job-101');
    const key2 = getOrCreateIdempotencyKey('dispatch:pickup:job-101');
    expect(key1).not.toBe(key2);
  });

  it('resets all cached keys completely with resetAllIdempotencyKeys', () => {
    const key1 = getOrCreateIdempotencyKey('key-a');
    const key2 = getOrCreateIdempotencyKey('key-b');
    resetAllIdempotencyKeys();
    const key1New = getOrCreateIdempotencyKey('key-a');
    const key2New = getOrCreateIdempotencyKey('key-b');
    expect(key1).not.toBe(key1New);
    expect(key2).not.toBe(key2New);
  });
});
