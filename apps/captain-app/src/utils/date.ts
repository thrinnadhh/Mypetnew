/**
 * Date and time formatting utility for Indian Standard Time.
 */

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = formatTime(isoString);
    if (isToday) {
      return `Today • ${timeStr}`;
    }
    return `${formatDate(isoString)} • ${timeStr}`;
  } catch {
    return '—';
  }
}

/**
 * Calculates remaining seconds until `expiresAt` based on current local clock.
 * Returns 0 if expired or invalid.
 */
export function getRemainingSeconds(expiresAtIso: string | null | undefined): number {
  if (!expiresAtIso) return 0;
  try {
    const expiry = new Date(expiresAtIso).getTime();
    if (isNaN(expiry)) return 0;
    const now = Date.now();
    const diff = Math.max(0, Math.floor((expiry - now) / 1000));
    return diff;
  } catch {
    return 0;
  }
}

/**
 * Formats seconds into MM:SS.
 */
export function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
