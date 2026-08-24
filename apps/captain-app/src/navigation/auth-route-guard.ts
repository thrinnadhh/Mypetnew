export function authRouteRedirect(
  authenticated: boolean,
  restoring: boolean,
  rootSegment: string | undefined,
): '/auth/login' | '/' | null {
  if (restoring) return null;
  const onAuthRoute = rootSegment === 'auth';
  if (!authenticated && !onAuthRoute) return '/auth/login';
  if (authenticated && onAuthRoute) return '/';
  return null;
}
