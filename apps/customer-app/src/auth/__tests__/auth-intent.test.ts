import {
  normalizeAuthIntent,
  parseAuthIntent,
  serializeAuthIntent,
} from '@/auth/auth-intent';

describe('auth intents', () => {
  it('round-trips a protected destination', () => {
    const intent = { action: 'CHECKOUT' as const, returnTo: '/checkout', params: { cartId: 'cart-1' } };
    expect(parseAuthIntent(serializeAuthIntent(intent))).toEqual(intent);
  });

  it('rejects non-app, unknown, legacy, and protocol-relative destinations', () => {
    const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));
    expect(parseAuthIntent(encoded({ action: 'ADMIN', returnTo: '/(tabs)/home' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: 'https://evil.example' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '//evil.example' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '/admin' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '/legacy-checkout' }))).toBeNull();
  });

  it('rejects malformed params instead of forwarding them into Expo Router', () => {
    expect(normalizeAuthIntent({ action: 'CHECKOUT', returnTo: '/checkout', params: ['cart-1'] })).toBeNull();
    expect(normalizeAuthIntent({ action: 'CHECKOUT', returnTo: '/checkout', params: { cartId: 123 } })).toBeNull();
    expect(normalizeAuthIntent({ action: 'CHECKOUT', returnTo: '/checkout', params: { 'bad/key': 'x' } })).toBeNull();
  });

  it('throws rather than serializing an unsafe in-memory intent', () => {
    expect(() => serializeAuthIntent({ action: 'CHECKOUT', returnTo: '/admin' })).toThrow('Unsafe authentication continuation intent');
  });
});
