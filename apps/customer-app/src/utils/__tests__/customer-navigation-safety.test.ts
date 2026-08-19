import {
  backOrReplace,
  formatIndiaDateTime,
  isSafeHttpsUrl,
  safeTelephoneUrl,
  singleRouteParam,
} from '@/utils/customer-navigation-safety';

describe('customer navigation safety', () => {
  it('uses router history when a normal stack exists', () => {
    const router = {
      canGoBack: jest.fn(() => true),
      back: jest.fn(),
      replace: jest.fn(),
    };

    expect(backOrReplace(router, '/appointments')).toBe('back');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('replaces with the canonical parent on direct entry', () => {
    const router = {
      canGoBack: jest.fn(() => false),
      back: jest.fn(),
      replace: jest.fn(),
    };

    expect(backOrReplace(router, '/appointments')).toBe('replace');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/appointments');
  });

  it('normalizes duplicate Expo Router params without crashing', () => {
    expect(singleRouteParam([' first ', 'second'])).toBe('first');
    expect(singleRouteParam(' one ')).toBe('one');
    expect(singleRouteParam([])).toBeNull();
    expect(singleRouteParam('   ')).toBeNull();
  });

  it('allows HTTPS documents but rejects unsafe or credentialed schemes', () => {
    expect(isSafeHttpsUrl('https://files.example.com/report.pdf')).toBe(true);
    expect(isSafeHttpsUrl('http://files.example.com/report.pdf')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpsUrl('file:///private/report.pdf')).toBe(false);
    expect(isSafeHttpsUrl('https://user:pass@example.com/report.pdf')).toBe(false);
  });

  it('normalizes telephone destinations and rejects injected schemes', () => {
    expect(safeTelephoneUrl('+91 98765 43210')).toBe('tel:+919876543210');
    expect(safeTelephoneUrl('0877-2233445')).toBe('tel:08772233445');
    expect(safeTelephoneUrl('tel:+919876543210')).toBeNull();
    expect(safeTelephoneUrl('javascript:alert(1)')).toBeNull();
  });

  it('formats valid timestamps for India and fails safely for invalid values', () => {
    expect(formatIndiaDateTime('2026-08-20T00:00:00Z')).toMatch(/20 Aug 2026/);
    expect(formatIndiaDateTime('not-a-date')).toBe('Date unavailable');
  });
});
