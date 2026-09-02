import type { BarcodeType } from '../catalog/api';

export type BarcodeInputSource = 'CAMERA' | 'MANUAL' | 'HARDWARE';
export type ScannerPermissionState =
  | 'UNDETERMINED'
  | 'REQUESTING'
  | 'GRANTED'
  | 'DENIED'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export type AcceptedBarcode = {
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  source: BarcodeInputSource;
};

function invalidBarcode(): never {
  const error = new Error('The barcode is not valid.');
  error.name = 'BARCODE_INVALID';
  throw error;
}

function hasValidGtinCheckDigit(value: string): boolean {
  const expected = Number(value[value.length - 1]);
  let sum = 0;
  const body = value.slice(0, -1).split('').reverse();
  body.forEach((character, index) => {
    sum += Number(character) * (index % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === expected;
}

export function normalizeMerchantBarcode(type: BarcodeType, raw: string): string {
  if (!raw || raw.length > 64 || /[\u0000-\u001f\u007f]/.test(raw)) invalidBarcode();
  if (type === 'INTERNAL') {
    const normalized = raw.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(normalized)) invalidBarcode();
    return normalized;
  }

  if (/[^0-9 -]/.test(raw)) invalidBarcode();
  const normalized = raw.replace(/[^0-9]/g, '');
  const expectedDigits: Record<Exclude<BarcodeType, 'INTERNAL'>, number> = {
    GTIN_8: 8,
    GTIN_12: 12,
    GTIN_13: 13,
    GTIN_14: 14,
  };
  if (normalized.length !== expectedDigits[type] || !hasValidGtinCheckDigit(normalized)) invalidBarcode();
  return normalized;
}

export class BarcodeDebounceGate {
  private previousKey: string | null = null;
  private previousAcceptedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly debounceMs = 1200) {}

  accept(
    barcodeType: BarcodeType,
    rawBarcode: string,
    source: BarcodeInputSource,
    nowMs: number = Date.now(),
  ): AcceptedBarcode | null {
    const normalizedBarcode = normalizeMerchantBarcode(barcodeType, rawBarcode);
    const key = `${barcodeType}:${normalizedBarcode}`;
    if (key === this.previousKey && nowMs - this.previousAcceptedAt < this.debounceMs) return null;
    this.previousKey = key;
    this.previousAcceptedAt = nowMs;
    return { barcodeType, normalizedBarcode, source };
  }

  reset(): void {
    this.previousKey = null;
    this.previousAcceptedAt = Number.NEGATIVE_INFINITY;
  }
}

export function scannerPermissionNotice(permission: ScannerPermissionState): string | null {
  if (permission === 'UNAVAILABLE') return 'Camera is unavailable on this device or environment. Use manual barcode entry.';
  if (permission === 'DENIED') return 'Camera permission was denied. You can still enter the barcode manually.';
  if (permission === 'BLOCKED') return 'Camera access is blocked in system settings. Use manual barcode entry or enable camera access in Settings.';
  return null;
}

export function cameraBarcodeType(rawType: string, data: string): BarcodeType | null {
  const type = rawType.trim().toLowerCase();
  if (type === 'ean8') return 'GTIN_8';
  if (type === 'upc_a' || type === 'upca') return 'GTIN_12';
  if (type === 'ean13') return 'GTIN_13';
  if (type === 'itf14' || type === 'itf-14') return 'GTIN_14';
  const digits = data.replace(/[^0-9]/g, '');
  if (type === 'code128' && digits.length === 14) return 'GTIN_14';
  return null;
}
