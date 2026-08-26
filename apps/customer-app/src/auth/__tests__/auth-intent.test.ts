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

  it('round-trips structurally valid UUID-bound order and appointment detail destinations', () => {
    const order = {
      action: 'ORDER_HISTORY' as const,
      returnTo: '/orders/99999999-9999-4999-8999-999999999999',
    };
    const appointment = {
      action: 'ORDER_HISTORY' as const,
      returnTo: '/appointments/88888888-8888-6888-7888-888888888888',
    };
    expect(parseAuthIntent(serializeAuthIntent(order))).toEqual(order);
    expect(parseAuthIntent(serializeAuthIntent(appointment))).toEqual(appointment);
  });

  it('rejects non-app, unknown, legacy, protocol-relative, and malformed detail destinations', () => {
    const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));
    expect(parseAuthIntent(encoded({ action: 'ADMIN', returnTo: '/(tabs)/home' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: 'https://evil.example' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '//evil.example' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '/admin' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'CHECKOUT', returnTo: '/legacy-checkout' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'ORDER_HISTORY', returnTo: '/orders/not-a-uuid' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'ORDER_HISTORY', returnTo: '/orders/99999999-9999-4999-8999-999999999999/../../admin' }))).toBeNull();
    expect(parseAuthIntent(encoded({ action: 'ORDER_HISTORY', returnTo: '/appointments/88888888-8888-6888-7888-888888888888?admin=1' }))).toBeNull();
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
