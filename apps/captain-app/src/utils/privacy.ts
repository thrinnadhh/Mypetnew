/**
 * Privacy & Log Sanitization Utilities
 *
 * Enforces data minimization and privacy rules:
 * - Redacts exact GPS coordinates in normal application logs
 * - Redacts customer addresses and phone numbers
 * - Prevents raw PII leakage to standard output
 */

export function sanitizeCoordinates(latitude?: number | null, longitude?: number | null): string {
  if (latitude == null || longitude == null) return '[no coordinates]';
  const latStr = latitude.toFixed(4);
  const lonStr = longitude.toFixed(4);
  const maskedLat = latStr.slice(0, latStr.indexOf('.') + 3) + '***';
  const maskedLon = lonStr.slice(0, lonStr.indexOf('.') + 3) + '***';
  return `(lat: ${maskedLat}, lon: ${maskedLon})`;
}

export function sanitizeAddress(address?: string | null): string {
  if (!address) return '[no address]';
  // Redact street numbers and keep only partial city/area info
  const parts = address.split(',');
  if (parts.length <= 1) {
    return address.length > 8 ? `${address.substring(0, 4)}***` : '***';
  }
  return `***, ${parts[parts.length - 1].trim()}`;
}

export function sanitizePhone(phone?: string | null): string {
  if (!phone) return '[no phone]';
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 4)}******${phone.slice(-2)}`;
}

export const logger = {
  debug: (tag: string, message: string, meta?: Record<string, any>) => {
    if (__DEV__) {
      // meta should already be sanitized
      // eslint-disable-next-line no-console
      console.debug(`[${tag}] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  },
  info: (tag: string, message: string, meta?: Record<string, any>) => {
    // eslint-disable-next-line no-console
    console.info(`[${tag}] ${message}`, meta ? JSON.stringify(meta) : '');
  },
  warn: (tag: string, message: string, meta?: Record<string, any>) => {
    // eslint-disable-next-line no-console
    console.warn(`[${tag}] ${message}`, meta ? JSON.stringify(meta) : '');
  },
  error: (tag: string, message: string, error?: any) => {
    const errorMsg = error instanceof Error ? error.message : String(error || '');
    // eslint-disable-next-line no-console
    console.error(`[${tag}] ${message}: ${errorMsg}`);
  },
};
