import { authRouteRedirect } from '../../navigation/auth-route-guard';

describe('authenticated navigation boundary', () => {
  it('does not redirect while session bootstrap is unresolved', () => {
    expect(authRouteRedirect(false, true, 'delivery')).toBeNull();
  });

  it('removes privileged routes after logout and avoids auth redirect loops', () => {
    expect(authRouteRedirect(false, false, 'delivery')).toBe('/auth/login');
    expect(authRouteRedirect(false, false, '(tabs)')).toBe('/auth/login');
    expect(authRouteRedirect(false, false, 'auth')).toBeNull();
  });

  it('sends an authenticated Captain through canonical bootstrap from auth routes', () => {
    expect(authRouteRedirect(true, false, 'auth')).toBe('/');
    expect(authRouteRedirect(true, false, 'delivery')).toBeNull();
  });
});
