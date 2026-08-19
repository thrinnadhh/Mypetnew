export interface BackNavigationRouter {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: never) => void;
}

export function backOrReplace(router: BackNavigationRouter, fallback: string): 'back' | 'replace' {
  if (router.canGoBack()) {
    router.back();
    return 'back';
  }
  router.replace(fallback as never);
  return 'replace';
}

export function singleRouteParam(value?: string | string[] | null): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim();
  return normalized || null;
}

export function isSafeHttpsUrl(value?: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export function safeTelephoneUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\+?[0-9(). -]{7,25}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

export function formatIndiaDateTime(value?: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
