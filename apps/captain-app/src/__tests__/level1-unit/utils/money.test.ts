import { formatPaise, paiseToRupees } from '../../../utils/money';

describe('Level 1: Money Utility Tests (Integer Paise)', () => {
  it('formats positive paise values to INR rupee strings', () => {
    expect(formatPaise(7500)).toBe('₹75');
    expect(formatPaise(7550)).toBe('₹75.50');
    expect(formatPaise(100000)).toBe('₹1,000');
    expect(formatPaise(123456)).toBe('₹1,234.56');
    expect(formatPaise(10000000)).toBe('₹1,00,000');
  });

  it('handles zero values appropriately', () => {
    expect(formatPaise(0, { showZero: true })).toBe('₹0');
    expect(formatPaise(0, { showZero: false })).toBe('—');
  });

  it('gracefully handles null and undefined without throwing', () => {
    expect(formatPaise(null)).toBe('—');
    expect(formatPaise(undefined)).toBe('—');
    expect(formatPaise(NaN as any)).toBe('—');
  });

  it('converts integer paise to float rupees accurately', () => {
    expect(paiseToRupees(7500)).toBe(75);
    expect(paiseToRupees(7550)).toBe(75.5);
    expect(paiseToRupees(0)).toBe(0);
    expect(paiseToRupees(1)).toBe(0.01);
  });
});
