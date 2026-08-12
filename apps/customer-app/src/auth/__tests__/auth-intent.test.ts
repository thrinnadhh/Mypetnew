import { parseAuthIntent, serializeAuthIntent } from '@/auth/auth-intent';

describe('auth intents', () => {
  it('round-trips a protected destination', () => {
    const intent = { action: 'CHECKOUT' as const, returnTo: '/checkout', params: { cartId: 'cart-1' } };
    expect(parseAuthIntent(serializeAuthIntent(intent))).toEqual(intent);
  });
  it('rejects non-app and unknown intents', () => {
    expect(parseAuthIntent(encodeURIComponent(JSON.stringify({ action: 'ADMIN', returnTo: '/admin' })))).toBeNull();
    expect(parseAuthIntent(encodeURIComponent(JSON.stringify({ action: 'CHECKOUT', returnTo: 'https://evil.example' })))).toBeNull();
  });
});
