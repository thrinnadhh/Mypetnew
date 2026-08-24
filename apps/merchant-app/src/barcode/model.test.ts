import {
  BarcodeDebounceGate,
  cameraBarcodeType,
  normalizeMerchantBarcode,
  scannerPermissionNotice,
} from './model';

describe('Merchant M4 barcode model', () => {
  it.each([
    ['GTIN_8', '01234565', '01234565'],
    ['GTIN_12', '012345678905', '012345678905'],
    ['GTIN_13', '0 123456 789012', '0123456789012'],
    ['GTIN_14', '01-234567890128', '01234567890128'],
  ] as const)('validates %s and preserves leading zeroes', (type, raw, expected) => {
    expect(normalizeMerchantBarcode(type, raw)).toBe(expected);
  });

  it('normalizes internal codes without converting them to numbers', () => {
    expect(normalizeMerchantBarcode('INTERNAL', '  pet-food.001 ')).toBe('PET-FOOD.001');
  });

  it.each([
    ['GTIN_8', '01234564'],
    ['GTIN_12', '123'],
    ['GTIN_13', '012345678901X'],
    ['INTERNAL', 'bad code'],
  ] as const)('rejects invalid %s input', (type, raw) => {
    expect(() => normalizeMerchantBarcode(type, raw)).toThrow('The barcode is not valid.');
  });

  it('debounces duplicate scans while allowing different or later scans', () => {
    const gate = new BarcodeDebounceGate(1000);
    expect(gate.accept('GTIN_13', '0123456789012', 'CAMERA', 100)).toMatchObject({
      normalizedBarcode: '0123456789012',
      source: 'CAMERA',
    });
    expect(gate.accept('GTIN_13', '0123456789012', 'CAMERA', 500)).toBeNull();
    expect(gate.accept('GTIN_8', '01234565', 'CAMERA', 600)).not.toBeNull();
    expect(gate.accept('GTIN_13', '0123456789012', 'MANUAL', 1200)).not.toBeNull();
  });

  it('keeps manual entry available when camera permission is denied or blocked', () => {
    expect(scannerPermissionNotice('DENIED')).toContain('manually');
    expect(scannerPermissionNotice('BLOCKED')).toContain('manual barcode entry');
    expect(scannerPermissionNotice('GRANTED')).toBeNull();
    const gate = new BarcodeDebounceGate();
    expect(gate.accept('INTERNAL', 'MANUAL-1', 'MANUAL', 1)).toMatchObject({ source: 'MANUAL' });
  });

  it('maps supported camera symbologies without guessing unsupported formats', () => {
    expect(cameraBarcodeType('ean8', '01234565')).toBe('GTIN_8');
    expect(cameraBarcodeType('upc_a', '012345678905')).toBe('GTIN_12');
    expect(cameraBarcodeType('ean13', '0123456789012')).toBe('GTIN_13');
    expect(cameraBarcodeType('itf14', '01234567890128')).toBe('GTIN_14');
    expect(cameraBarcodeType('qr', '0123456789012')).toBeNull();
  });
});
