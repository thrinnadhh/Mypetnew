import {
  isValidIfsc,
  isValidIndianMobile,
  isValidPinCode,
  sanitizeIndianMobile,
} from '../../../utils/validation';

describe('Level 1: Validation Utility Tests', () => {
  describe('Indian Mobile Number Validation & Normalization', () => {
    it('normalizes 10-digit mobile number with +91 country prefix', () => {
      expect(sanitizeIndianMobile('9876543210')).toBe('+919876543210');
      expect(sanitizeIndianMobile('+919876543210')).toBe('+919876543210');
      expect(sanitizeIndianMobile('919876543210')).toBe('+919876543210');
      expect(sanitizeIndianMobile('98765 43210')).toBe('+919876543210');
    });

    it('validates 10-digit Indian numbers starting with 6-9', () => {
      expect(isValidIndianMobile('9876543210')).toBe(true);
      expect(isValidIndianMobile('8765432109')).toBe(true);
      expect(isValidIndianMobile('7654321098')).toBe(true);
      expect(isValidIndianMobile('6543210987')).toBe(true);
      expect(isValidIndianMobile('+919876543210')).toBe(true);
    });

    it('rejects invalid numbers', () => {
      expect(isValidIndianMobile('5876543210')).toBe(false); // starts with 5
      expect(isValidIndianMobile('12345')).toBe(false); // too short
      expect(isValidIndianMobile('98765432109999')).toBe(false); // too long
      expect(isValidIndianMobile('abcdefghij')).toBe(false); // non-numeric
    });
  });

  describe('PIN Code & IFSC Validation', () => {
    it('validates 6-digit Indian PIN codes', () => {
      expect(isValidPinCode('560034')).toBe(true);
      expect(isValidPinCode('517501')).toBe(true);
      expect(isValidPinCode('110001')).toBe(true);

      expect(isValidPinCode('56003')).toBe(false); // 5 digits
      expect(isValidPinCode('5600344')).toBe(false); // 7 digits
      expect(isValidPinCode('56003A')).toBe(false); // alphanumeric
    });

    it('validates 11-character Indian IFSC codes', () => {
      expect(isValidIfsc('HDFC0001234')).toBe(true);
      expect(isValidIfsc('SBIN0000456')).toBe(true);
      expect(isValidIfsc('ICIC0000001')).toBe(true);

      expect(isValidIfsc('HDFC1001234')).toBe(false); // 5th character must be 0
      expect(isValidIfsc('HDF0001234')).toBe(false); // too short
      expect(isValidIfsc('HDFC00012345')).toBe(false); // too long
    });
  });
});
