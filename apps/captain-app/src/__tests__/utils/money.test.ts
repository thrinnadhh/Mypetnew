import { formatPaise, paiseToRupees } from '../../utils/money';

describe('Money Formatter (Integer Paise)', () => {
  it('formats integer paise to clean INR string', () => {
    expect(formatPaise(7500)).toBe('₹75');
    expect(formatPaise(7550)).toBe('₹75.50');
    expect(formatPaise(100000)).toBe('₹1,000');
    expect(formatPaise(123456)).toBe('₹1,234.56');
  });

  it('handles zero and null cases gracefully', () => {
    expect(formatPaise(0, { showZero: true })).toBe('₹0');
    expect(formatPaise(null)).toBe('—');
    expect(formatPaise(undefined)).toBe('—');
  });

  it('converts paise to rupees correctly', () => {
    expect(paiseToRupees(7500)).toBe(75);
    expect(paiseToRupees(7550)).toBe(75.5);
  });
});
