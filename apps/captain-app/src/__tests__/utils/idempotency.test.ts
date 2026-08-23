import {
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  resetAllIdempotencyKeys,
} from '../../utils/idempotency';

describe('Idempotency Key Manager', () => {
  beforeEach(() => {
    resetAllIdempotencyKeys();
  });

  it('generates a stable key for the same command key', () => {
    const key1 = getOrCreateIdempotencyKey('dispatch:pickup:job-1');
    const key2 = getOrCreateIdempotencyKey('dispatch:pickup:job-1');
    expect(key1).toBe(key2);
  });

  it('generates different keys for different command keys', () => {
    const key1 = getOrCreateIdempotencyKey('dispatch:pickup:job-1');
    const key2 = getOrCreateIdempotencyKey('dispatch:delivered:job-1');
    expect(key1).not.toBe(key2);
  });

  it('clears key when operation succeeds and generates new one afterwards', () => {
    const key1 = getOrCreateIdempotencyKey('dispatch:pickup:job-1');
    clearIdempotencyKey('dispatch:pickup:job-1');
    const key2 = getOrCreateIdempotencyKey('dispatch:pickup:job-1');
    expect(key1).not.toBe(key2);
  });
});
