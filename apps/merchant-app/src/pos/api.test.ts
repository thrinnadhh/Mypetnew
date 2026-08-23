import { lookupBarcode, completePosSale } from './api';

describe('Merchant POS API', () => {
  it('handles barcode lookup with empty string returning null', async () => {
    const result = await lookupBarcode('outlet-1', '');
    expect(result).toBeNull();
  });

  it('exports POS types correctly', () => {
    expect(typeof lookupBarcode).toBe('function');
    expect(typeof completePosSale).toBe('function');
  });
});
